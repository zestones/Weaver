import type { Card } from '@weaver/memory'
import type { Period } from './period.ts'

// What the registry of cards holds, counted. What was opened, written or closed is counted over the period; what
// waits is what waits now, whenever it was opened.
export interface CardFigures {
  readonly opened: { readonly total: number; readonly byOrigin: Readonly<Record<string, number>> }
  readonly written: number
  readonly writingFailed: number
  // What was written on cards once they existed, with what the notes that conclude said of their card.
  readonly notes: { readonly total: number; readonly byConclusion: Readonly<Record<string, number>> }
  readonly closed: { readonly total: number; readonly byClosing: Readonly<Record<string, number>> }
  // `oldestAt` is when the card that has waited longest was opened.
  readonly waiting: { readonly total: number; readonly notWritten: number; readonly oldestAt: string | null }
}

export class CardNumbers {
  private readonly cards: readonly Card[]
  private readonly period: Period

  constructor(cards: readonly Card[], period: Period) {
    this.cards = cards
    this.period = period
  }

  get figures(): CardFigures {
    const records = this.cards.map((card) => card.record)
    const opened = records.filter((record) => this.period.holds(record.provenance.at))
    const closed = records.filter((record) => this.period.holds(record.closing?.at))
    const waiting = this.cards.filter((card) => card.isWaiting)
    const [oldest = null] = waiting.map((card) => card.record.provenance.at).sort()
    const failures = records.flatMap((record) => record.history).filter((event) => event.action === 'writing-failed')
    const notes = records.flatMap((record) => record.notes).filter((note) => this.period.holds(note.provenance.at))

    return {
      opened: { total: opened.length, byOrigin: this.counted(opened.map((record) => record.origin)) },
      written: records.filter((record) => this.period.holds(record.written?.at)).length,
      writingFailed: failures.filter((event) => this.period.holds(event.at)).length,
      notes: { total: notes.length, byConclusion: this.counted(notes.flatMap((note) => note.conclusion ?? [])) },
      closed: { total: closed.length, byClosing: this.counted(closed.flatMap((record) => record.closing?.as ?? [])) },
      waiting: {
        total: waiting.length,
        notWritten: waiting.filter((card) => card.state === 'raw').length,
        oldestAt: oldest,
      },
    }
  }

  private counted(words: readonly string[]): Record<string, number> {
    const counts: Record<string, number> = {}

    for (const word of words) counts[word] = (counts[word] ?? 0) + 1

    return counts
  }
}
