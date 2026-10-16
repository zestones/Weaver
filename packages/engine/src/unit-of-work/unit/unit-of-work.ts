import { createHash } from 'node:crypto'
import type { AttributionWindow, Change, ClosedWindow } from '../attribution/attribution-window.ts'
import type { Intent, LiftedCall, ReturnedFile, UnitCards, UnitFile, UnitRecord } from './unit-record.ts'

type Files = Readonly<Record<string, UnitFile>>
type Returned = Readonly<Record<string, ReturnedFile>>

export class UnitOfWork {
  readonly record: UnitRecord

  constructor(record: UnitRecord) {
    this.record = record
  }

  static fresh(number: number): UnitOfWork {
    return new UnitOfWork({
      number,
      openedAt: new Date().toISOString(),
      files: {},
      intents: [],
      check: { rounds: 0, result: null, reminded: false, reviewed: [], reviewing: null },
      unattributed: [],
      lifted: [],
      returned: {},
      cards: { concerned: [], noted: [], asked: [] },
    })
  }

  get number(): number {
    return this.record.number
  }

  get files(): Files {
    return this.record.files
  }

  get rounds(): number {
    return this.record.check.rounds
  }

  get reviewRounds(): number {
    return this.record.check.reviewed.length
  }

  get lastReviewed(): string | null {
    return this.record.check.reviewed.at(-1) ?? null
  }

  get reviewing(): string | null {
    return this.record.check.reviewing
  }

  get requests(): string[] {
    return this.record.intents.map((intent) => intent.text)
  }

  // What the files of the unit hold now, as one name: the same content is the same name.
  content(): string {
    const held = Object.entries(this.record.files)
      .map(([path, file]) => `${path}\0${file.last ?? ''}`)
      .sort()

    return createHash('sha1').update(held.join('\n')).digest('hex')
  }

  get reminded(): boolean {
    return this.record.check.reminded
  }

  get unattributed(): readonly string[] {
    return this.record.unattributed
  }

  get lifted(): readonly LiftedCall[] {
    return this.record.lifted
  }

  get cards(): UnitCards {
    return this.record.cards
  }

  // The cards it is about that its agent wrote nothing on, and that the end of the task did not ask a note for yet.
  get unnotedCards(): number[] {
    const { concerned, noted, asked } = this.record.cards

    return concerned.filter((card) => !noted.includes(card) && !asked.includes(card))
  }

  get isEmpty(): boolean {
    return Object.keys(this.record.files).length === 0
  }

  get hasRequests(): boolean {
    return this.record.intents.length > 0
  }

  withRequest(intent: Intent): UnitOfWork {
    const { intents, check } = this.record
    const known = intents.some((earlier) => earlier.text === intent.text)

    return new UnitOfWork({
      ...this.record,
      intents: known ? intents : [...intents, intent],
      check: { ...check, rounds: 0, reminded: false, reviewed: [] },
    })
  }

  // The same call made again is one thing for the owner to look at.
  withLifted(call: LiftedCall): UnitOfWork {
    const known = this.lifted.some((earlier) => earlier.guard === call.guard && earlier.what === call.what)

    return known ? this : new UnitOfWork({ ...this.record, lifted: [...this.lifted, call] })
  }

  withFailedRound(): UnitOfWork {
    return new UnitOfWork({ ...this.record, check: { ...this.record.check, rounds: this.rounds + 1, result: 'fail' } })
  }

  withReviewRound(content: string): UnitOfWork {
    const { check } = this.record

    return new UnitOfWork({ ...this.record, check: { ...check, reviewed: [...check.reviewed, content], reviewing: null } })
  }

  withReviewRunning(content: string | null): UnitOfWork {
    return new UnitOfWork({ ...this.record, check: { ...this.record.check, reviewing: content } })
  }

  withReminder(): UnitOfWork {
    return new UnitOfWork({ ...this.record, check: { ...this.record.check, reminded: true } })
  }

  withConcerned(cards: readonly number[]): UnitOfWork {
    const { concerned } = this.record.cards

    return this.withCards({ concerned: [...concerned, ...cards.filter((card) => !concerned.includes(card))] })
  }

  withNoted(card: number): UnitOfWork {
    const { noted } = this.record.cards

    return noted.includes(card) ? this : this.withCards({ noted: [...noted, card] })
  }

  withCardsAsked(cards: readonly number[]): UnitOfWork {
    return this.withCards({ asked: [...this.record.cards.asked, ...cards] })
  }

  withFiles(files: Files): UnitOfWork {
    return new UnitOfWork({ ...this.record, files: this.changed(files) })
  }

  // A git action of the owner may change what HEAD holds: what a file returned to is then no base to go by.
  withoutReturned(): UnitOfWork {
    return new UnitOfWork({ ...this.record, returned: {} })
  }

  charge(window: AttributionWindow, closed: ClosedWindow): { unit: UnitOfWork; foreign: string[] } {
    const now = new Date().toISOString()
    const files: Record<string, UnitFile> = { ...this.record.files }

    for (const [path, change] of closed.charged) files[path] = this.touched(path, change, window, now)

    const kept = this.changed(files)
    const unattributed = [...new Set([...this.record.unattributed, ...closed.shown])].filter((path) => !(path in kept))

    return {
      unit: new UnitOfWork({ ...this.record, files: kept, unattributed, returned: this.returnedWith(files, kept) }),
      foreign: [...closed.charged.keys()].filter((path) => files[path]?.foreign === true),
    }
  }

  // What a call changed, from what the files held before the session first touched them, as the end of the task will
  // judge it. A file the call put back as it was holds no change any more.
  sinceBase(changes: ReadonlyMap<string, Change>): Map<string, Change> {
    return new Map(
      [...changes].flatMap(([path, change]): [string, Change][] => {
        const known = this.record.files[path] ?? this.record.returned[path]

        if (known === undefined) return [[path, change]]

        return known.base === change.after ? [] : [[path, { before: known.base, after: change.after }]]
      }),
    )
  }

  successor(checked: Files): UnitOfWork {
    // A file the session changed again since the check stays, for the next unit.
    const kept = Object.entries(this.record.files).filter(([path, file]) => checked[path]?.last !== file.last)

    return new UnitOfWork({ ...UnitOfWork.fresh(this.number + 1).record, files: Object.fromEntries(kept) })
  }

  private withCards(cards: Partial<UnitCards>): UnitOfWork {
    return new UnitOfWork({ ...this.record, cards: { ...this.record.cards, ...cards } })
  }

  private changed(files: Files): Record<string, UnitFile> {
    return Object.fromEntries(Object.entries(files).filter(([, file]) => file.base !== file.last))
  }

  private returnedWith(files: Files, kept: Files): Returned {
    const back = Object.entries(files).filter(([path]) => !(path in kept))
    const earlier = Object.entries(this.record.returned).filter(([path]) => !(path in files))

    return Object.fromEntries([...earlier, ...back.map(([path, { base, since }]) => [path, { base, since }] as const)])
  }

  // The base is what the earliest look at a file saw. A window that closes late, such as one whose call never ran or
  // ran in the background, saw it before the session first did only if it opened before then: otherwise its before is
  // the session's own work. A file that differs from what the session last left in it was changed by someone else,
  // unless the session changed it again while this window was open.
  private touched(path: string, change: Change, window: AttributionWindow, now: string): UnitFile {
    const file = this.record.files[path]
    const known = file ?? this.record.returned[path]

    if (known === undefined) return { base: change.before, last: change.after, foreign: false, touchedAt: now, since: window.openedAt }

    const earlier = window.openedAt < known.since
    const base = earlier ? change.before : known.base
    const since = earlier ? window.openedAt : known.since
    const foreign = file !== undefined && (file.foreign || (file.last !== change.before && file.touchedAt < window.openedAt))

    return { base, last: change.after, foreign, touchedAt: now, since }
  }
}
