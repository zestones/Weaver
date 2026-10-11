import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type {
  CardClosing,
  CardEvent,
  CardOrigin,
  CardRecord,
  CardState,
  Closing,
  Occurrence,
  Provenance,
  ReviewContent,
  WrittenCard,
} from '../cards/card-record.ts'
import { Card } from '../cards/card.ts'
import type { FlagFields, Place, PlaceContext } from '../flags/flag-record.ts'
import { PlaceText } from '../flags/place-text.ts'
import { inTransaction, migrate, openDatabase, schemaVersion } from '../lib/sqlite/database.ts'
import { oneLine } from '../lib/text/clip.ts'
import { CardTable, type CardFilter } from './card-table.ts'
import { RegistryError } from './registry-error.ts'
import { MIGRATIONS } from './registry-schema.ts'
import { WriterTurn } from './writer-turn.ts'

export interface NewFlag {
  // The id of the tool call that made it; the same call records once. null for the owner.
  readonly callId: string | null
  readonly places: readonly Place[]
  readonly fields: FlagFields
  readonly text: string
  readonly context: readonly PlaceContext[]
  readonly provenance: Provenance
}

export interface Flagged {
  readonly card: Card
  // true when this very flag was already recorded: same call, or same text in the same session and unit.
  readonly known: boolean
}

export interface NewReviewCard {
  readonly origin: 'finding' | 'suspicion'
  readonly places: readonly Place[]
  readonly content: ReviewContent
  readonly provenance: Provenance
}

const FILE = 'registry.sqlite'
// A write is a few milliseconds: past this, something holds the database that will not let go.
const BUSY_TIMEOUT_MS = 5000

// Everything agents, reviewers and the owner left for the owner to decide on, in one database that several processes
// write at once: a hook that records a flag, a worker that writes cards, a command of the owner.
export class CardRegistry {
  private readonly path: string
  private readonly db: DatabaseSync
  private readonly cards: CardTable
  private readonly turn: WriterTurn

  constructor(stateDir: string) {
    this.path = join(stateDir, FILE)
    this.db = this.guarded(() => {
      mkdirSync(stateDir, { recursive: true })

      return this.opened()
    })
    this.cards = new CardTable(this.db)
    this.turn = new WriterTurn(this.db)
  }

  close(): void {
    this.db.close()
  }

  flag(flag: NewFlag): Flagged {
    return this.write(() => {
      const known = this.known(flag)

      if (known !== null) return { card: new Card(known), known: true }

      const { callId, places, fields, text, context, provenance } = flag
      const origin = provenance.role === 'owner' ? 'owner' : 'flag'
      const record = { ...this.blank(origin, 'raw', places, provenance, 'flagged'), flag: { fields, text, context } }

      return { card: new Card(this.cards.insert(record, { callId, reviewKey: null })), known: false }
    })
  }

  // A finding or a suspicion of a review becomes an open card at once. The same point of the same rule at the same
  // place as a card that waits is an occurrence of that card, not a new one.
  open(card: NewReviewCard): Card {
    return this.write(() => {
      const { origin, places, content, provenance } = card
      // A caller that sends the same point of the same review again is given the card it went to.
      const point = JSON.stringify([content.review, content.message])
      const taken = this.cards.cardOfPoint(point)

      if (taken !== null) return new Card(this.existing(taken))

      const reviewKey = this.reviewKey(card)
      const waiting = this.cards.waitingAs(reviewKey)
      const kept =
        waiting === null
          ? this.cards.insert({ ...this.blank(origin, 'open', places, provenance, 'opened'), review: content }, { callId: null, reviewKey })
          : this.cards.update(
              this.after(waiting, 'seen-again', content.review, {
                occurrences: [...waiting.occurrences, { card: null, provenance, note: `${content.review}: ${content.message}` }],
              }),
            )

      this.cards.keepPoint(point, kept.number)

      return new Card(kept)
    })
  }

  find(number: number): Card | null {
    return this.guarded(() => {
      const record = this.cards.read(number)

      return record === null ? null : new Card(record)
    })
  }

  list(filter: CardFilter = {}): Card[] {
    return this.guarded(() => this.cards.select(filter).map((record) => new Card(record)))
  }

  // Every card that names one of these files, whatever its state except merged, newest first.
  about(files: readonly string[]): Card[] {
    return this.guarded(() => this.cards.naming(files).map((record) => new Card(record)))
  }

  closeCard(number: number, as: Closing, reason: string | null, issue: string | null = null): Card {
    return this.change(number, (record) => {
      const why = reason === null || reason.trim() === '' ? null : reason.trim()

      if (record.state === 'merged') throw new RegistryError(`${this.merged(record)}: close that one`)
      if (record.state === 'closed')
        throw new RegistryError(`card #${String(number)} is already closed as ${record.closing?.as ?? ''}`.trimEnd())
      if (as === 'wontfix' && why === null) throw new RegistryError(`closing card #${String(number)} as wontfix needs a reason`)

      const closing: CardClosing = { as, reason: why, issue, at: this.now() }

      return this.after(record, 'closed', why === null ? as : `${as}: ${why}`, { state: 'closed', closing, seenSinceClosing: false })
    })
  }

  reopen(number: number, note: string | null): Card {
    return this.change(number, (record) => {
      if (record.state === 'merged') throw new RegistryError(`${this.merged(record)}: separate it to have it back`)
      if (record.state !== 'closed') throw new RegistryError(`card #${String(number)} is not closed: it is ${record.state}`)

      return this.after(record, 'reopened', note, {
        state: this.standing({ ...record, closing: null }),
        closing: null,
        seenSinceClosing: false,
      })
    })
  }

  correct(
    number: number,
    change: {
      title?: string
      labels?: Readonly<Record<string, readonly string[]>>
      sections?: readonly { name: string; text: string }[]
    },
  ): Card {
    return this.change(number, (record) => {
      const { written } = record
      const { title, labels, sections } = change
      const given = Object.entries({ title, labels, sections }).flatMap(([name, value]) => (value === undefined ? [] : [name]))

      if (written === null) {
        throw new RegistryError(`card #${String(number)} has no title, labels or sections to correct: the writer did not write it`)
      }
      if (given.length === 0) throw new RegistryError('a correction gives a title, labels or sections: this one gives none')
      if (title?.trim() === '') throw new RegistryError('the title of a card cannot be empty')

      return this.after(record, 'corrected', given.join(', '), {
        written: {
          ...written,
          title: title === undefined ? written.title : oneLine(title),
          labels: labels ?? written.labels,
          sections: sections ?? written.sections,
        },
      })
    })
  }

  // The two cards may be about the same thing, and nobody is sure: they stay two.
  tie(a: number, b: number, note: string | null): void {
    this.write(() => {
      const [left, right] = [this.existing(a), this.existing(b)]

      if (a === b) throw new RegistryError(`card #${String(a)} cannot be tied to itself`)
      if (left.state === 'merged') throw new RegistryError(`${this.merged(left)}: tie that one`)
      if (right.state === 'merged') throw new RegistryError(`${this.merged(right)}: tie that one`)
      if (left.ties.includes(b)) throw new RegistryError(`cards #${String(a)} and #${String(b)} are already tied`)

      const why = note === null ? '' : `: ${note}`

      this.cards.update(this.after(left, 'tied', `to #${String(b)}${why}`, { ties: [...left.ties, b] }))
      this.cards.update(this.after(right, 'tied', `to #${String(a)}${why}`, { ties: [...right.ties, a] }))
    })
  }

  untie(a: number, b: number): void {
    this.write(() => {
      const [left, right] = [this.existing(a), this.existing(b)]

      if (!left.ties.includes(b)) throw new RegistryError(`cards #${String(a)} and #${String(b)} are not tied`)

      this.cards.update(this.after(left, 'untied', `from #${String(b)}`, { ties: left.ties.filter((tie) => tie !== b) }))
      this.cards.update(this.after(right, 'untied', `from #${String(a)}`, { ties: right.ties.filter((tie) => tie !== a) }))
    })
  }

  // `from` is the same thing as `into`: it becomes an occurrence of it, and `into` is the card given back. A closed
  // `into` is marked as seen since, and stays closed.
  merge(from: number, into: number, note: string): Card {
    return this.write(() => {
      const [source, target] = [this.existing(from), this.existing(into)]

      if (from === into) throw new RegistryError(`card #${String(from)} cannot be merged into itself`)
      if (source.state === 'merged') throw new RegistryError(`${this.merged(source)} already`)
      if (target.state === 'merged') throw new RegistryError(`${this.merged(target)}: merge into that one`)

      const occurrence: Occurrence = { card: from, provenance: source.provenance, note }

      this.cards.update(this.after(source, 'merged', `into #${String(into)}: ${note}`, { state: 'merged', mergedInto: into }))

      return new Card(
        this.cards.update(
          this.after(target, 'seen-again', `${this.seenAs(from)} ${note}`, {
            occurrences: [...target.occurrences, occurrence],
            seenSinceClosing: target.seenSinceClosing || target.state === 'closed',
          }),
        ),
      )
    })
  }

  // Undoes a merge: the card is a card again, as it was, and the other loses the occurrence.
  separate(number: number): Card {
    return this.write(() => {
      const record = this.existing(number)
      const into = record.mergedInto === null ? null : this.cards.read(record.mergedInto)

      if (record.state !== 'merged') throw new RegistryError(`card #${String(number)} is not merged into another`)

      if (into !== null) {
        const occurrences = into.occurrences.filter((occurrence) => occurrence.card !== number)
        const seenSinceClosing = this.seenSince(into, occurrences)

        this.cards.update(this.after(into, 'separated', `card #${String(number)} is another thing`, { occurrences, seenSinceClosing }))
      }

      return new Card(
        this.cards.update(
          this.after(record, 'separated', `from #${String(record.mergedInto)}`, { state: this.standing(record), mergedInto: null }),
        ),
      )
    })
  }

  // The flags no writer has written up, and that were not tried `maxAttempts` times already.
  awaitingWriter(maxAttempts: number): Card[] {
    return this.guarded(() => this.cards.awaitingWriter(maxAttempts).map((record) => new Card(record)))
  }

  // A flag the owner closed while the writer worked gains its card all the same, and stays closed.
  written(number: number, written: WrittenCard): Card {
    return this.change(number, (record) => {
      if (record.flag === null) throw new RegistryError(`card #${String(number)} comes from a review: the writer has nothing to write`)
      if (record.written !== null) throw new RegistryError(`card #${String(number)} is already written`)

      return this.after(record, 'written', null, {
        state: record.state === 'raw' ? 'open' : record.state,
        written,
        writing: { ...record.writing, failure: null },
      })
    })
  }

  writingFailed(number: number, failure: string): Card {
    return this.change(number, (record) =>
      this.after(record, 'writing-failed', failure, { writing: { attempts: record.writing.attempts + 1, failure } }),
    )
  }

  // One writer at a time in a repository. false when another one holds it and its process is alive.
  takeWriterTurn(pid: number): boolean {
    return this.write(() => this.turn.take(pid))
  }

  leaveWriterTurn(pid: number): void {
    this.write(() => {
      this.turn.leave(pid)
    })
  }

  // A database newer than this code is refused before anything is written to it.
  private opened(): DatabaseSync {
    const db = openDatabase(this.path, BUSY_TIMEOUT_MS)

    try {
      if (migrate(db, MIGRATIONS)) return db

      throw new RegistryError(
        `${this.path} was written by a newer Weaver: its schema is at version ${String(schemaVersion(db))}, and this one knows up to ${String(MIGRATIONS.length)}. Nothing in it was changed: update Weaver to read it.`,
      )
    } catch (error) {
      db.close()

      throw error
    }
  }

  private write<T>(work: () => T): T {
    return this.guarded(() => inTransaction(this.db, work))
  }

  // Whoever calls the registry catches one kind of error, whether a rule refused or the database did.
  private guarded<T>(work: () => T): T {
    try {
      return work()
    } catch (error) {
      if (error instanceof RegistryError) throw error

      throw new RegistryError(`the registry at ${this.path} could not be used: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      })
    }
  }

  private change(number: number, how: (record: CardRecord) => CardRecord): Card {
    return this.write(() => new Card(this.cards.update(how(this.existing(number)))))
  }

  private existing(number: number): CardRecord {
    const record = this.cards.read(number)

    if (record === null) throw new RegistryError(`no card has the number ${String(number)}`)

    return record
  }

  // Without a session, nothing tells a flag of the owner from the same words said again another day.
  private known({ callId, text, provenance }: NewFlag): CardRecord | null {
    const sameCall = callId === null ? null : this.cards.ofCall(callId)

    if (sameCall !== null || provenance.session === null) return sameCall

    return this.cards.ofText(provenance.session, provenance.unit, text)
  }

  // What makes two points of reviews one thing. A rule broken at a place is the same however it is worded; a
  // suspicion, or a finding without a place, is only what its words say: a wrong merge would hide a discovery.
  private reviewKey({ origin, places, content }: NewReviewCard): string {
    const where = places.map((place) => PlaceText.write(place)).sort()
    const worded = origin === 'suspicion' || where.length === 0

    return JSON.stringify([origin, content.rule, where, worded ? oneLine(content.message).toLowerCase() : null])
  }

  private blank(
    origin: CardOrigin,
    state: CardState,
    places: readonly Place[],
    provenance: Provenance,
    action: CardEvent['action'],
  ): CardRecord {
    return {
      number: this.cards.nextNumber(),
      origin,
      state,
      places,
      provenance,
      flag: null,
      review: null,
      written: null,
      closing: null,
      proposal: null,
      seenSinceClosing: false,
      occurrences: [],
      ties: [],
      mergedInto: null,
      writing: { attempts: 0, failure: null },
      history: [this.event(action, null)],
    }
  }

  private after(record: CardRecord, action: CardEvent['action'], note: string | null, change: Partial<CardRecord>): CardRecord {
    return { ...record, ...change, history: [...record.history, this.event(action, note)] }
  }

  private event(action: CardEvent['action'], note: string | null): CardEvent {
    return { at: this.now(), action, note }
  }

  private now(): string {
    return new Date().toISOString()
  }

  private merged(record: CardRecord): string {
    return `card #${String(record.number)} was merged into #${String(record.mergedInto)}`
  }

  // The state of a card that is not merged: what it holds says it.
  private standing({ closing, flag, written }: CardRecord): CardState {
    if (closing !== null) return 'closed'

    return flag !== null && written === null ? 'raw' : 'open'
  }

  private seenAs(card: number): string {
    return `as card #${String(card)}:`
  }

  // Whether one of the cards still kept as occurrences came after the closing: the history of the card they were
  // merged into holds both, in the order they happened.
  private seenSince({ closing, history }: CardRecord, occurrences: readonly Occurrence[]): boolean {
    const closed = history.findLastIndex((event) => event.action === 'closed')
    const seen = (card: number) =>
      history.findLastIndex((event) => event.action === 'seen-again' && event.note?.startsWith(this.seenAs(card)))

    return closing !== null && occurrences.some(({ card }) => card !== null && seen(card) > closed)
  }
}
