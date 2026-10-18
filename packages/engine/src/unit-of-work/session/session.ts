import { mkdirSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { Repository } from '../../lib/git/repository.ts'
import { AttributionWindow, type Change, type WatchedCall } from '../attribution/attribution-window.ts'
import { Touch } from '../attribution/touch.ts'
import type { EventBody } from '../journal/journal-event.ts'
import { Journal } from '../journal/journal.ts'
import type { OwnerRequest } from '../owner/owner-request.ts'
import { Reconciliation } from '../owner/reconciliation.ts'
import { UnitOfWork } from '../unit/unit-of-work.ts'
import type { LiftedCall, UnitFile } from '../unit/unit-record.ts'
import { ContinuedSession } from './continued-session.ts'
import { HeldElsewhere } from './held-elsewhere.ts'
import type { SessionRecord } from './session-record.ts'
import { SessionStore, type Transaction } from './session-store.ts'

const REPAIR = 'fix'
const SHORT_ID_LENGTH = 8

export class Session {
  readonly repo: Repository
  readonly id: string
  readonly dir: string
  readonly agent: string
  private readonly store: SessionStore
  private readonly journal: Journal

  constructor(repo: Repository, sessionId: string, agent: string) {
    this.repo = repo
    this.dir = Session.dirOf(repo, sessionId)
    this.id = basename(this.dir)
    this.agent = agent
    this.store = new SessionStore(this.dir, agent)
    this.journal = new Journal(repo)
    mkdirSync(this.dir, { recursive: true })
  }

  // The session as a hook meets it: one the runtime went on with under a new id first takes over the state it left.
  static met(repo: Repository, sessionId: string, agent: string, transcript: string | null): Session {
    const continued = new ContinuedSession(Session.rootIn(repo), Session.dirOf(repo, sessionId), sessionId, transcript).takeOver()
    const session = new Session(repo, sessionId, agent)

    if (continued !== null) session.log({ kind: 'continue', from: continued })

    return session
  }

  static rootIn(repo: Repository): string {
    return join(repo.gitDir, 'weaver', 'sessions')
  }

  private static dirOf(repo: Repository, sessionId: string): string {
    return join(Session.rootIn(repo), sessionId.replace(/[^\w.-]/g, '_'))
  }

  state(): SessionRecord | null {
    return this.store.load()
  }

  // The first characters of its id that no other session of the repository shares, eight at least: what the owner
  // types to name it.
  get shortId(): string {
    const others = readdirSync(dirname(this.dir)).filter((id) => id !== this.id)

    for (let length = SHORT_ID_LENGTH; length < this.id.length; length += 1) {
      const start = this.id.slice(0, length)

      if (!others.some((other) => other.startsWith(start))) return start
    }

    return this.id
  }

  // When the session was last at work; null when it left no state.
  get seenAt(): Date | null {
    return this.store.changedAt()
  }

  get lastRequest(): string | null {
    return this.unit().requests.at(-1) ?? null
  }

  // Since when the owner lifts the guards of the project for this session; null outside maintenance.
  get maintenance(): string | null {
    return this.state()?.maintenance ?? null
  }

  // False when maintenance was already as asked.
  maintain(on: boolean): boolean {
    const { value: changed } = this.store.transact((latest) => {
      const changed = (latest.maintenance !== null) !== on

      return { record: changed ? { ...latest, maintenance: on ? new Date().toISOString() : null } : latest, value: changed }
    })

    if (changed) this.log({ kind: 'maintenance', on })

    return changed
  }

  // A task with no end in sight is given up on after this long, should the runtime never tell of its end.
  static readonly BACKGROUND_GIVEN_UP_MS = 12 * 60 * 60 * 1000

  // `timeoutMs` is how long the runtime keeps the task, when it says. The window of the call that started it, when it
  // has one, now waits for the task to end.
  startedInBackground(task: string, timeoutMs: number | null, callId: string | null): void {
    const until = new Date(Date.now() + (timeoutMs ?? Session.BACKGROUND_GIVEN_UP_MS)).toISOString()

    this.store.update((latest) => {
      const window = callId === null ? undefined : latest.pending[callId]
      const waiting = callId !== null && window !== undefined ? { [callId]: { ...window, task } } : {}

      return { ...latest, pending: { ...latest.pending, ...waiting }, background: { ...latest.background, [task]: until } }
    })
  }

  // What the task wrote is the agent's: the calls that waited for it close now, those of a subagent that ended too.
  endedInBackground(task: string): Touch[] {
    this.store.update((latest) => ({
      ...latest,
      background: Object.fromEntries(Object.entries(latest.background).filter(([id]) => id !== task)),
    }))

    return this.close((latest) =>
      Object.entries(latest.pending)
        .filter(([, window]) => new AttributionWindow(window).runsFor(new Set([task])))
        .map(([id]) => id),
    )
  }

  // Whether the agent waits for a task it left running: it may stop without ending its work, and resume at its end.
  get waitsInBackground(): boolean {
    return this.running(this.state()).size > 0
  }

  asked(names: readonly string[]): void {
    this.store.update((latest) => ({ ...latest, asked: { at: new Date().toISOString(), names } }))
  }

  // Whether the agent ran `weaver check` with these names since `since`: the one command that does reads it, once.
  takeAsked(names: readonly string[], since: string): boolean {
    return this.store.transact((latest) => {
      const { asked } = latest
      const same = asked !== null && asked.at >= since && asked.names.join('\0') === names.join('\0')

      return { record: same ? { ...latest, asked: null } : latest, value: same }
    }).value
  }

  // What a guard would have refused waits for the owner with the unit of work it was made in.
  lift(tool: string, call: LiftedCall): void {
    this.store.update((latest) => ({ ...latest, unit: new UnitOfWork(latest.unit).withLifted(call).record }))
    this.log({ kind: 'lift', tool, ...call })
  }

  log(event: EventBody): void {
    this.journal.append({ session: this.id, agent: this.agent }, event)
  }

  // The number of the unit of work the request joins.
  request(request: OwnerRequest): number {
    return this.reconciled((record) => ({
      ...record,
      unit: new UnitOfWork(record.unit).withRequest(request.intent(record.lastReply)).record,
    })).unit.number
  }

  watch(callId: string, call: WatchedCall): void {
    const window = AttributionWindow.open(this.repo, call)

    this.store.update((latest) => ({
      ...latest,
      // A session met at its first call takes HEAD as it is: what moves it later is someone's git action.
      head: latest.head ?? this.repo.head(),
      pending: { ...latest.pending, [callId]: window.record },
    }))
  }

  closeCall(callId: string): Touch[] {
    return this.close((latest) => (latest.pending[callId]?.untilStop === true ? [] : [callId]))
  }

  // At the end of the agent's turn, the calls that will never be told of their end: one its runtime refused after the
  // hook let it through, or one that failed where no hook follows a failure. A call still running for a task left in
  // the background, a subagent's among them, closes when it ends, or when that task does.
  closeEndedCalls(): Touch[] {
    return this.close((latest) => {
      const running = this.running(latest)

      return Object.entries(latest.pending)
        .filter(([, window]) => !new AttributionWindow(window).runsFor(running))
        .sort(([, older], [, newer]) => older.at.localeCompare(newer.at))
        .map(([id]) => id)
    })
  }

  unit(): UnitOfWork {
    const record = this.state()

    return record === null ? UnitOfWork.fresh(1) : new UnitOfWork(record.unit)
  }

  // The repairs of the project's checks run as one call of the session: what they rewrite stays the agent's work.
  async repair(repairs: () => Promise<void>): Promise<readonly string[]> {
    this.watch(REPAIR, { tool: REPAIR, targets: null, scope: 'all', untilStop: false, agent: null })
    await repairs()

    return this.closeCall(REPAIR).flatMap((touch) => touch.paths)
  }

  endTurn(lastMessage: string | null): UnitOfWork {
    return new UnitOfWork(this.reconciled((record) => ({ ...record, lastReply: lastMessage })).unit)
  }

  // True the first time for the request in progress: the agent is told once how to end its work.
  remind(): boolean {
    return this.store.transact((latest) => {
      const unit = new UnitOfWork(latest.unit)

      return unit.reminded ? { record: latest, value: false } : { record: { ...latest, unit: unit.withReminder().record }, value: true }
    }).value
  }

  reviewRound(content: string): void {
    this.store.update((latest) => ({ ...latest, unit: new UnitOfWork(latest.unit).withReviewRound(content).record }))
  }

  reviewRunning(content: string | null): void {
    this.store.update((latest) => ({ ...latest, unit: new UnitOfWork(latest.unit).withReviewRunning(content).record }))
  }

  get failedReview(): string | null {
    return this.state()?.failedReview ?? null
  }

  reviewFailed(content: string | null): void {
    this.store.update((latest) => ({ ...latest, failedReview: content, unit: new UnitOfWork(latest.unit).withReviewRunning(null).record }))
  }

  // A flag is journaled each time it is made; one that is new is named to the owner when the turn ends.
  flagged(card: number, known: boolean): void {
    const { unit } = this.store.update((latest) => (known ? latest : { ...latest, flagged: [...latest.flagged, card] }))

    this.log({ kind: 'flag', unit: unit.number, card, known })
  }

  // A note that concludes nothing is free text: the card is still owed a report.
  noted(card: number, conclusion: string | null): void {
    const { unit } = this.store.update((latest) =>
      conclusion === null ? latest : { ...latest, unit: new UnitOfWork(latest.unit).withNoted(card).record },
    )

    this.log({ kind: 'note', unit: unit.number, card, conclusion })
  }

  // The unit of work is about the cards its agent reads, and those whose files its calls change. Gives those it was
  // not about yet.
  concerned(cards: readonly number[]): number[] {
    return this.store.transact((latest) => {
      const unit = new UnitOfWork(latest.unit)
      const added = cards.filter((card) => !unit.cards.concerned.includes(card))

      return { record: added.length === 0 ? latest : { ...latest, unit: unit.withConcerned(added).record }, value: added }
    }).value
  }

  // The cards of the unit its agent wrote nothing on: the end of the task asks once for their notes.
  askNotes(): number[] {
    return this.store.transact((latest) => {
      const unit = new UnitOfWork(latest.unit)
      const unnoted = unit.unnotedCards

      return { record: unnoted.length === 0 ? latest : { ...latest, unit: unit.withCardsAsked(unnoted).record }, value: unnoted }
    }).value
  }

  takeFlags(): readonly number[] {
    return this.store.transact((latest) => ({ record: { ...latest, flagged: [] }, value: latest.flagged })).value
  }

  failRound(): number {
    return this.store.update((latest) => ({ ...latest, unit: new UnitOfWork(latest.unit).withFailedRound().record })).unit.check.rounds
  }

  settle(checked: Readonly<Record<string, UnitFile>>): void {
    const next = this.store.update((latest) => ({ ...latest, unit: new UnitOfWork(latest.unit).successor(checked).record }))

    this.log({ kind: 'settle', unit: next.unit.number - 1, files: Object.keys(checked).length, by: 'check', notes: [] })
  }

  // The tasks left in the background that have not ended, nor outlived the time they were given.
  private running(record: SessionRecord | null): Set<string> {
    const now = new Date().toISOString()

    return new Set(Object.entries(record?.background ?? {}).flatMap(([task, until]) => (until > now ? [task] : [])))
  }

  private reconciled(change: (record: SessionRecord) => SessionRecord): SessionRecord {
    const { record, value: notes } = this.store.transact((latest) => {
      const { head, unit, notes } = new Reconciliation(this.repo, latest.head, new UnitOfWork(latest.unit)).apply()

      return { record: change({ ...latest, head, unit: unit.record }), value: notes }
    })

    if (notes.length > 0) this.log({ kind: 'settle', unit: record.unit.number, files: notes.length, by: 'owner', notes })

    return record
  }

  private close(ids: (record: SessionRecord) => readonly string[]): Touch[] {
    const { value: touches } = this.store.transact((latest) => {
      let record = latest
      const touches: Touch[] = []

      for (const id of ids(latest)) {
        const closed = this.closed(record, id)

        record = closed.record
        if (closed.value !== null) touches.push(closed.value)
      }

      return { record, value: touches }
    })

    for (const touch of touches) for (const event of touch.events()) this.log(event)

    return touches
  }

  private closed(latest: SessionRecord, id: string): Transaction<Touch | null> {
    const pending = latest.pending[id]

    if (pending === undefined) return { record: latest, value: null }

    const window = new AttributionWindow(pending)
    const elsewhere = new HeldElsewhere(this.repo, dirname(this.dir), this.id)
    const closed = window.close(this.repo, (paths) => elsewhere.among(paths))
    const others = this.writtenByOthers(latest, id, window, closed.charged)
    const { unit, foreign } = new UnitOfWork(latest.unit).charge(window, closed)

    return {
      record: {
        ...latest,
        pending: Object.fromEntries(Object.entries(latest.pending).filter(([key]) => key !== id)),
        // A call that moved HEAD is not the owner acting: the next look starts from where the call left it, so that a
        // commit made by an agent settles nothing.
        head: closed.headMoved === null ? latest.head : closed.headMoved.to,
        unit: unit.record,
      },
      value: new Touch({ tool: window.tool, changes: closed.charged, shown: closed.shown, foreign, headMoved: closed.headMoved, others }),
    }
  }

  // A call that names its writes wrote them. One that may write anything did not write what another call of the
  // session left in a file while it ran, nor what a call still open names.
  private writtenByOthers(latest: SessionRecord, id: string, window: AttributionWindow, charged: ReadonlyMap<string, Change>): string[] {
    if (window.record.exact) return []

    const claimed = new Set(
      Object.entries(latest.pending).flatMap(([other, record]) => (other === id ? [] : new AttributionWindow(record).claims)),
    )

    return [...charged].flatMap(([path, change]) => {
      const file = latest.unit.files[path]
      const written = file !== undefined && file.last === change.after && file.touchedAt > window.openedAt

      return written || claimed.has(path) ? [path] : []
    })
  }
}
