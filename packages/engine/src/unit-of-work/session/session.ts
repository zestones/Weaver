import { mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Repository } from '../../lib/git/repository.ts'
import { AttributionWindow, type WatchedCall } from '../attribution/attribution-window.ts'
import { Touch } from '../attribution/touch.ts'
import type { EventBody } from '../journal/journal-event.ts'
import { Journal } from '../journal/journal.ts'
import type { OwnerRequest } from '../owner/owner-request.ts'
import { Reconciliation } from '../owner/reconciliation.ts'
import { UnitOfWork } from '../unit/unit-of-work.ts'
import type { UnitFile } from '../unit/unit-record.ts'
import type { SessionRecord } from './session-record.ts'
import { SessionStore, type Transaction } from './session-store.ts'

export class Session {
  readonly repo: Repository
  readonly id: string
  readonly dir: string
  readonly agent: string
  private readonly store: SessionStore
  private readonly journal: Journal

  constructor(repo: Repository, sessionId: string, agent: string) {
    this.repo = repo
    this.dir = join(repo.gitDir, 'weaver', 'sessions', sessionId.replace(/[^\w.-]/g, '_'))
    this.id = basename(this.dir)
    this.agent = agent
    this.store = new SessionStore(this.dir, agent)
    this.journal = new Journal(repo)
    mkdirSync(this.dir, { recursive: true })
  }

  state(): SessionRecord | null {
    return this.store.load()
  }

  log(event: EventBody): void {
    this.journal.append({ session: this.id, agent: this.agent }, event)
  }

  request(request: OwnerRequest): void {
    this.reconciled((record) => ({
      ...record,
      unit: new UnitOfWork(record.unit).withRequest(request.intent(record.lastReply)).record,
    }))
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

  closeOpenCalls(): Touch[] {
    return this.close((latest) =>
      Object.entries(latest.pending)
        .sort(([, older], [, newer]) => older.at.localeCompare(newer.at))
        .map(([id]) => id),
    )
  }

  endTurn(lastMessage: string | null): UnitOfWork {
    return new UnitOfWork(this.reconciled((record) => ({ ...record, lastReply: lastMessage })).unit)
  }

  failRound(): number {
    return this.store.update((latest) => ({ ...latest, unit: new UnitOfWork(latest.unit).withFailedRound().record })).unit.check.rounds
  }

  settle(checked: Readonly<Record<string, UnitFile>>): void {
    const next = this.store.update((latest) => ({ ...latest, unit: new UnitOfWork(latest.unit).successor(checked).record }))

    this.log({ kind: 'settle', unit: next.unit.number - 1, files: Object.keys(checked).length, by: 'check', notes: [] })
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
    const closed = window.close(this.repo)
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
      value: new Touch({ tool: window.tool, paths: [...closed.charged.keys()], shown: closed.shown, foreign, headMoved: closed.headMoved }),
    }
  }
}
