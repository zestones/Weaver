import { createHash } from 'node:crypto'
import type { AttributionWindow, Change, ClosedWindow } from '../attribution/attribution-window.ts'
import type { Intent, UnitFile, UnitRecord } from './unit-record.ts'

type Files = Readonly<Record<string, UnitFile>>

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

  withFiles(files: Files): UnitOfWork {
    return new UnitOfWork({ ...this.record, files: this.changed(files) })
  }

  charge(window: AttributionWindow, closed: ClosedWindow): { unit: UnitOfWork; foreign: string[] } {
    const now = new Date().toISOString()
    const files: Record<string, UnitFile> = { ...this.record.files }

    for (const [path, change] of closed.charged) files[path] = this.touched(files[path], change, window, now)

    const kept = this.changed(files)
    const unattributed = [...new Set([...this.record.unattributed, ...closed.shown])].filter((path) => !(path in kept))

    return {
      unit: new UnitOfWork({ ...this.record, files: kept, unattributed }),
      foreign: [...closed.charged.keys()].filter((path) => files[path]?.foreign === true),
    }
  }

  successor(checked: Files): UnitOfWork {
    // A file the session changed again since the check stays, for the next unit.
    const kept = Object.entries(this.record.files).filter(([path, file]) => checked[path]?.last !== file.last)

    return new UnitOfWork({ ...UnitOfWork.fresh(this.number + 1).record, files: Object.fromEntries(kept) })
  }

  private changed(files: Files): Record<string, UnitFile> {
    return Object.fromEntries(Object.entries(files).filter(([, file]) => file.base !== file.last))
  }

  // A file that differs from what the session last left in it was changed by someone else, unless the session changed it
  // again while this window was open.
  private touched(file: UnitFile | undefined, change: Change, window: AttributionWindow, now: string): UnitFile {
    if (file === undefined) return { base: change.before, last: change.after, foreign: false, touchedAt: now }

    const foreign = file.foreign || (file.last !== change.before && file.touchedAt < window.openedAt)

    return { base: file.base, last: change.after, foreign, touchedAt: now }
  }
}
