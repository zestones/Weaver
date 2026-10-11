import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { CardOrigin, CardRecord, CardState } from '../cards/card-record.ts'
import { Card } from '../cards/card.ts'

export interface CardFilter {
  // Default: the cards that wait, raw and open.
  readonly states?: readonly CardState[]
  readonly file?: string
  // `family:value`.
  readonly label?: string
  readonly origin?: CardOrigin
  readonly session?: string
  readonly unit?: number
}

// What tells that a thing was already recorded, kept beside the record.
export interface CardKeys {
  readonly callId: string | null
  readonly reviewKey: string | null
}

const WAITING: readonly CardState[] = ['raw', 'open']

// The rows of the registry. A card is one row that holds its record as JSON; the columns and the two tables beside it
// repeat what the queries look for.
export class CardTable {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  // Asked under the write lock, so that no other process is given the same number.
  nextNumber(): number {
    return Number(this.db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS next FROM cards').get()?.next ?? 1)
  }

  insert(record: CardRecord, keys: CardKeys): CardRecord {
    const { number, state, origin, provenance, writing } = record

    this.db
      .prepare(
        'INSERT INTO cards (number, state, origin, session, unit, call_id, review_key, attempts, record) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        number,
        state,
        origin,
        provenance.session,
        provenance.unit,
        keys.callId,
        keys.reviewKey,
        writing.attempts,
        JSON.stringify(record),
      )

    for (const file of new Set(record.places.map((place) => place.file))) {
      this.db.prepare('INSERT INTO card_files (card, file) VALUES (?, ?)').run(number, file)
    }

    return record
  }

  // The places of a card, its session and its unit never change: only what does is written again.
  update(record: CardRecord): CardRecord {
    const { number, state, writing } = record

    this.db
      .prepare('UPDATE cards SET state = ?, attempts = ?, record = ? WHERE number = ?')
      .run(state, writing.attempts, JSON.stringify(record), number)
    this.db.prepare('DELETE FROM card_labels WHERE card = ?').run(number)

    for (const label of new Set(new Card(record).labels())) {
      this.db.prepare('INSERT INTO card_labels (card, label) VALUES (?, ?)').run(number, label)
    }

    return record
  }

  read(number: number): CardRecord | null {
    return this.first('number = ?', [number])
  }

  ofCall(callId: string): CardRecord | null {
    return this.first('call_id = ?', [callId])
  }

  ofText(session: string, unit: number | null, text: string): CardRecord | null {
    return this.first("session = ? AND unit IS ? AND json_extract(record, '$.flag.text') = ?", [session, unit, text])
  }

  waitingAs(reviewKey: string): CardRecord | null {
    return this.first("review_key = ? AND state IN ('raw', 'open')", [reviewKey])
  }

  select(filter: CardFilter): CardRecord[] {
    const wanted: (readonly [string, SQLInputValue | undefined])[] = [
      ['state IN (SELECT value FROM json_each(?))', JSON.stringify(filter.states ?? WAITING)],
      ['origin = ?', filter.origin],
      ['session = ?', filter.session],
      ['unit = ?', filter.unit],
      ['number IN (SELECT card FROM card_files WHERE file = ?)', filter.file],
      ['number IN (SELECT card FROM card_labels WHERE label = ?)', filter.label],
    ]
    const asked = wanted.flatMap(([condition, value]) => (value === undefined ? [] : [{ condition, value }]))

    return this.all(
      `${asked.map(({ condition }) => condition).join(' AND ')} ORDER BY number`,
      asked.map(({ value }) => value),
    )
  }

  naming(files: readonly string[]): CardRecord[] {
    return this.all(
      "state != 'merged' AND number IN (SELECT card FROM card_files WHERE file IN (SELECT value FROM json_each(?))) ORDER BY number DESC",
      [JSON.stringify(files)],
    )
  }

  awaitingWriter(maxAttempts: number): CardRecord[] {
    return this.all("state = 'raw' AND attempts < ? ORDER BY number", [maxAttempts])
  }

  cardOfPoint(name: string): number | null {
    const card = this.db.prepare('SELECT card FROM review_points WHERE name = ?').get(name)?.card

    return typeof card === 'number' ? card : null
  }

  keepPoint(name: string, card: number): void {
    this.db.prepare('INSERT INTO review_points (name, card) VALUES (?, ?)').run(name, card)
  }

  private first(where: string, values: readonly SQLInputValue[]): CardRecord | null {
    return this.all(`${where} ORDER BY number LIMIT 1`, values)[0] ?? null
  }

  private all(where: string, values: readonly SQLInputValue[]): CardRecord[] {
    return this.db
      .prepare(`SELECT record FROM cards WHERE ${where}`)
      .all(...values)
      .map((row) => JSON.parse(String(row.record)) as CardRecord)
  }
}
