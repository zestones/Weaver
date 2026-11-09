import { isAlive } from '../lib/process/alive.ts'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type {
  CardClosing,
  ClosingProposal,
  CardEvent,
  CardNote,
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

export interface Noted {
  readonly card: Card
  // true when this very note was already on the card: the same words, from the same session and unit.
  readonly known: boolean
}

export interface NewReviewCard {
  readonly identity?: string
  readonly legacyPoint?: string
  readonly origin: 'finding' | 'suspicion'
  readonly places: readonly Place[]
  readonly content: ReviewContent
  readonly provenance: Provenance
}

interface WriterBatchRecord {
  readonly state: 'running' | 'answered' | 'completed'
  readonly pid: number
  readonly flags: readonly number[]
  readonly attempts: Readonly<Record<string, number>>
  readonly runtime: string
  readonly model: string | null
  readonly seconds: number
  readonly costUsd: number | null
  readonly failure: string | null
  readonly at: string
}

interface IssueAttempt {
  readonly status: 'running' | 'failed' | 'succeeded'
  readonly command: readonly string[]
  readonly output: string | null
  readonly at: string
  readonly revision: number
  readonly by: Provenance
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
  private acting: Provenance

  constructor(stateDir: string, actor?: Provenance) {
    this.acting = actor ?? {
      author: 'owner',
      role: 'owner',
      session: null,
      subagent: null,
      unit: null,
      requests: [],
      commit: null,
      at: new Date().toISOString(),
    }
    this.path = join(stateDir, FILE)
    this.db = this.guarded(() => {
      mkdirSync(stateDir, { recursive: true })

      return this.opened()
    })
    this.cards = new CardTable(this.db)
    this.turn = new WriterTurn(this.db)
    try {
      this.recoverWriting()
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  // Whether a registry was ever made there: opening one makes it.
  static isIn(stateDir: string): boolean {
    return existsSync(join(stateDir, FILE))
  }

  get actor(): Provenance {
    return this.acting
  }

  rememberCommand(id: string, words: readonly string[], actor: Provenance): void {
    this.write(() => {
      this.db
        .prepare('INSERT OR IGNORE INTO card_commands (id, words, actor) VALUES (?, ?, ?)')
        .run(id, JSON.stringify(words), JSON.stringify(actor))
    })
  }

  claimCommand(words: readonly string[]): void {
    this.write(() => {
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString()
      const row = this.db
        .prepare(
          "SELECT id, actor FROM card_commands WHERE words = ? AND claimed = 0 AND json_extract(actor, '$.at') >= ? ORDER BY rowid LIMIT 1",
        )
        .get(JSON.stringify(words), since)
      if (row === undefined) return
      this.acting = JSON.parse(String(row.actor)) as Provenance
      this.db.prepare('UPDATE card_commands SET claimed = 1 WHERE id = ?').run(String(row.id))
    })
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
    return this.write(() => this.opening(card))
  }

  private opening(card: NewReviewCard): Card {
    const { origin, places, content, provenance } = card
    // A caller that sends the same point of the same review again is given the card it went to.
    const point = card.identity ?? JSON.stringify([content.review, content.message])
    const taken = this.cards.cardOfPoint(point)

    if (taken !== null) return new Card(this.existing(taken))

    const legacy = card.legacyPoint === undefined ? null : this.cards.cardOfPoint(card.legacyPoint)
    const previous = legacy === null ? null : this.existing(legacy)
    const sameSession =
      previous !== null &&
      (previous.provenance.session === provenance.session ||
        previous.occurrences.some(
          (occurrence) =>
            occurrence.provenance.session === provenance.session && occurrence.note === `${content.review}: ${content.message}`,
        ))
    if (legacy !== null && sameSession) {
      this.cards.keepPoint(point, legacy)
      return new Card(this.existing(legacy))
    }
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
  }

  publishReview(id: string, session: string, points: readonly NewReviewCard[], unlessDelivered?: string): Card[] {
    return this.write(() => {
      if (unlessDelivered !== undefined && this.reviewDelivered(unlessDelivered)) return []
      const previous = this.db.prepare('SELECT cards FROM review_deliveries WHERE id = ?').get(id)
      if (previous !== undefined) return (JSON.parse(String(previous.cards)) as number[]).map((number) => new Card(this.existing(number)))
      const cards = points.map((point) => this.opening(point))
      this.db
        .prepare('INSERT INTO review_deliveries (id, session, cards) VALUES (?, ?, ?)')
        .run(id, session, JSON.stringify(cards.map((card) => card.number)))
      return cards
    })
  }

  reviewDelivered(id: string): boolean {
    return this.db.prepare('SELECT id FROM review_deliveries WHERE id = ?').get(id) !== undefined
  }

  reviewNotices(session: string, files: readonly string[]): Card[] {
    return this.write(() => {
      const rows = this.db
        .prepare(
          `SELECT id, cards FROM review_deliveries WHERE notified IS NULL AND cards != '[]'
          AND (session = ? OR EXISTS (SELECT 1 FROM json_each(review_deliveries.cards) point
            JOIN card_files ON card_files.card = point.value WHERE file IN (SELECT value FROM json_each(?))))
          ORDER BY rowid LIMIT 20`,
        )
        .all(session, JSON.stringify(files))
      const cards = new Map<number, Card>()
      for (const row of rows) {
        const listed = (JSON.parse(String(row.cards)) as number[]).map((number) => new Card(this.existing(number)))
        for (const card of listed) cards.set(card.number, card)
        this.db.prepare('UPDATE review_deliveries SET notified = ? WHERE id = ?').run(session, String(row.id))
      }
      return [...cards.values()]
    })
  }

  recoveryPosition(scope: string): string {
    return String(this.db.prepare('SELECT position FROM recovery_cursor WHERE name = ?').get(scope)?.position ?? '')
  }

  recoveredThrough(scope: string, position: string): void {
    this.db.prepare('INSERT OR REPLACE INTO recovery_cursor (name, position) VALUES (?, ?)').run(scope, position)
  }

  recordWriterBatch(record: WriterBatchRecord): number {
    return Number(this.db.prepare('INSERT INTO writer_batches (record) VALUES (?)').run(JSON.stringify(record)).lastInsertRowid)
  }

  writerBatches(): WriterBatchRecord[] {
    return this.db
      .prepare('SELECT record FROM writer_batches ORDER BY id')
      .all()
      .map((row) => JSON.parse(String(row.record)) as WriterBatchRecord)
  }

  updateWriterBatch(id: number, change: Partial<WriterBatchRecord>): void {
    const row = this.db.prepare('SELECT record FROM writer_batches WHERE id = ?').get(id)
    if (row === undefined) throw new RegistryError(`No writer batch ${String(id)}`)
    const record = JSON.parse(String(row.record)) as WriterBatchRecord
    this.db.prepare('UPDATE writer_batches SET record = ? WHERE id = ?').run(JSON.stringify({ ...record, ...change }), id)
  }

  private recoverWriting(): void {
    this.write(() => {
      const rows = this.db
        .prepare(
          "SELECT id, record FROM writer_batches WHERE json_extract(record, '$.state') IN ('running', 'answered') ORDER BY id LIMIT 20",
        )
        .all()
      for (const row of rows) {
        const batch = JSON.parse(String(row.record)) as WriterBatchRecord
        if (isAlive(batch.pid)) continue
        const failure = 'The writer stopped before applying its answer'
        for (const number of batch.flags) {
          const card = this.cards.read(number)
          if (card?.state !== 'raw' || card.writing.attempts !== batch.attempts[String(number)]) continue
          this.cards.update(this.after(card, 'writing-failed', failure, { writing: { attempts: card.writing.attempts + 1, failure } }))
        }
        this.updateWriterBatch(Number(row.id), { state: 'completed', failure })
      }
    })
  }

  retryWriting(): void {
    this.write(() => {
      for (const card of this.cards.select({ states: ['raw'] })) {
        if (card.writing.attempts > 0)
          this.cards.update(this.after(card, 'writing-failed', 'Explicit retry', { writing: { attempts: 0, failure: null } }))
      }
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

  claimResolution(numbers: readonly number[], holder: string, limit: number | null): Card[] {
    return this.write(() => {
      const now = Date.now()
      this.db.prepare('DELETE FROM resolution_claims WHERE expires <= ?').run(now)
      const claimed: Card[] = []
      for (const number of numbers) {
        if (limit !== null && claimed.length >= limit) break
        const record = this.cards.read(number)
        if (record === null) continue
        const card = new Card(record)
        if (
          !card.isWaiting ||
          card.decision.kind !== 'none' ||
          card.origin === 'suspicion' ||
          card.conclusion?.as === 'fixed' ||
          card.conclusion?.as === 'refuted'
        )
          continue
        const result = this.db
          .prepare('INSERT OR IGNORE INTO resolution_claims (card, holder, expires) VALUES (?, ?, ?)')
          .run(number, holder, now + 60 * 60 * 1000)
        if (result.changes > 0) claimed.push(card)
      }
      return claimed
    })
  }

  releaseResolution(holder: string): void {
    this.write(() => {
      this.db.prepare('DELETE FROM resolution_claims WHERE holder = ?').run(holder)
    })
  }

  closeCard(
    number: number,
    as: Closing,
    reason: string | null,
    issue: string | null = null,
    proposal: ClosingProposal | null = null,
  ): Card {
    return this.change(number, (record) => {
      const why = reason === null || reason.trim() === '' ? null : reason.trim()

      if (record.state === 'merged') throw new RegistryError(`${this.merged(record)}: close that one`)
      if (record.state === 'closed')
        throw new RegistryError(`card #${String(number)} is already closed as ${record.closing?.as ?? ''}`.trimEnd())
      if (as === 'wontfix' && why === null) throw new RegistryError(`closing card #${String(number)} as wontfix needs a reason`)

      if (proposal !== null) this.validateProposal(record, proposal)
      const closing: CardClosing = { as, reason: why, issue, at: this.now(), by: this.actor, proposal }

      return this.after(record, 'closed', why === null ? as : `${as}: ${why}`, { state: 'closed', closing, seenSinceClosing: false })
    })
  }

  showProposal(number: number, shown?: ClosingProposal | null): void {
    this.write(() => {
      const proposal = shown === undefined ? this.existing(number).proposal : shown
      if (proposal !== null)
        this.db.prepare('INSERT OR REPLACE INTO proposal_views (card, proposal) VALUES (?, ?)').run(number, JSON.stringify(proposal))
    })
  }

  shownProposal(number: number): ClosingProposal | null {
    return this.guarded(() => {
      const row = this.db.prepare('SELECT proposal FROM proposal_views WHERE card = ?').get(number)
      return row === undefined ? null : (JSON.parse(String(row.proposal)) as ClosingProposal)
    })
  }

  beginIssue(number: number, command: readonly string[]): IssueAttempt {
    return this.write(() => {
      const row = this.db.prepare('SELECT record FROM issue_filings WHERE card = ? ORDER BY id DESC LIMIT 1').get(number)
      const previous = row === undefined ? null : (JSON.parse(String(row.record)) as IssueAttempt)
      if (previous?.status === 'running')
        throw new RegistryError(
          'an earlier issue filing was interrupted; check the issue tracker, then run weaver cards issue-result <number> <url|not-filed> before retrying',
        )
      if (previous?.status === 'succeeded') return previous
      const record = this.existing(number)
      const attempt: IssueAttempt = {
        command,
        status: 'running',
        output: null,
        at: this.now(),
        revision: record.history.length,
        by: this.actor,
      }
      this.db.prepare('INSERT INTO issue_filings (card, record) VALUES (?, ?)').run(number, JSON.stringify(attempt))
      return attempt
    })
  }

  finishIssue(number: number, status: 'failed' | 'succeeded', output: string | null): void {
    this.write(() => {
      this.db
        .prepare(
          "UPDATE issue_filings SET record = json_set(record, '$.status', ?, '$.output', ?) WHERE id = (SELECT max(id) FROM issue_filings WHERE card = ?)",
        )
        .run(status, output, number)
    })
  }

  reconcileIssue(number: number, result: string): void {
    this.write(() => {
      this.existing(number)
      const row = this.db.prepare('SELECT record FROM issue_filings WHERE card = ? ORDER BY id DESC LIMIT 1').get(number)
      if (row === undefined) throw new RegistryError('this card has no issue filing to reconcile')
      const previous = JSON.parse(String(row.record)) as IssueAttempt
      const record: IssueAttempt = {
        ...previous,
        status: result === 'not-filed' ? 'failed' : 'succeeded',
        output: result === 'not-filed' ? null : result,
        by: this.actor,
        at: this.now(),
      }
      this.db.prepare('INSERT INTO issue_filings (card, record) VALUES (?, ?)').run(number, JSON.stringify(record))
    })
  }

  acceptProposal(number: number, proposal: ClosingProposal): Card {
    return this.closeCard(number, proposal.as, proposal.reason, null, proposal)
  }

  private validateProposal(record: CardRecord, proposal: ClosingProposal): void {
    if (record.proposal?.revision === proposal.revision && JSON.stringify(record.proposal) === JSON.stringify(proposal)) return
    const changes = record.history.slice(proposal.revision).map((event) => `${event.action}${event.note === null ? '' : `: ${event.note}`}`)
    throw new RegistryError(`closing proposal is stale: ${changes.join('; ') || 'the card or its notes changed'}. Read the card again`)
  }

  // Written on a card whatever its state, but for a merged one: what is found about it goes to the card it became.
  note(number: number, note: CardNote): Noted {
    return this.write(() => {
      const record = this.existing(number)
      const said = { ...note, id: `note-${String(record.notes.length + 1)}`, text: note.text.trim() }

      if (record.state === 'merged') throw new RegistryError(`${this.merged(record)}: write on that one`)
      if (said.text === '') throw new RegistryError('a note says something: this one is empty')
      if (record.notes.slice(record.lifecycle?.noteStart ?? 0).some((written) => this.sameNote(written, said)))
        return { card: new Card(record), known: true }

      const noted = this.after(record, 'noted', said.conclusion, { notes: [...record.notes, said] }, said.provenance)

      return { card: new Card(this.cards.update(noted)), known: false }
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
        lifecycle: {
          revision: record.lifecycle?.revision ?? record.history.length,
          cycle: (record.lifecycle?.cycle ?? 0) + 1,
          noteStart: record.notes.length,
          stage: 'uninvestigated',
        },
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
    reason?: string,
    expectedRevision?: number,
  ): Card {
    return this.change(number, (record) => {
      if (expectedRevision !== undefined && record.lifecycle?.revision !== expectedRevision)
        throw new RegistryError('card changed since it was read; read it again')
      const { written } = record
      const { title, labels, sections } = change
      const given = Object.entries({ title, labels, sections }).flatMap(([name, value]) => (value === undefined ? [] : [name]))

      if (written === null) {
        throw new RegistryError(`card #${String(number)} has no title, labels or sections to correct: the writer did not write it`)
      }
      if (given.length === 0) throw new RegistryError('a correction gives a title, labels or sections: this one gives none')
      if (title?.trim() === '') throw new RegistryError('the title of a card cannot be empty')

      const after = {
        ...written,
        title: title === undefined ? written.title : oneLine(title),
        labels: labels ?? written.labels,
        sections: sections ?? written.sections,
      }
      const why = reason ?? `Changed ${given.join(', ')}`
      return this.after(record, 'corrected', why, {
        written: after,
        revisions: [
          ...(record.revisions ?? []),
          { revision: record.history.length + 1, before: written, after, by: this.actor, reason: why },
        ],
      })
    })
  }

  restore(number: number, revision: number, reason: string): Card {
    const record = this.guarded(() => this.existing(number))
    const saved = record.revisions?.find((entry) => entry.revision === revision)
    if (saved === undefined) throw new RegistryError(`no content revision ${String(revision)} on this card`)
    return this.correct(number, saved.after, reason, record.lifecycle?.revision)
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
        revisions: [
          ...(record.revisions ?? []),
          { revision: record.history.length + 1, before: record.written, after: written, by: this.actor, reason: 'Writer content' },
        ],
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

  // A hook may see one call twice. Without a session, nothing tells a note of the owner from the same words said
  // again another day.
  private sameNote(written: CardNote, said: CardNote): boolean {
    const { session, unit } = said.provenance

    return (
      session !== null &&
      written.provenance.session === session &&
      written.provenance.unit === unit &&
      written.conclusion === said.conclusion &&
      written.text === said.text
    )
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
      notes: [],
      ties: [],
      mergedInto: null,
      writing: { attempts: 0, failure: null },
      history: [{ ...this.event(action, null), by: provenance }],
    }
  }

  private after(
    record: CardRecord,
    action: CardEvent['action'],
    note: string | null,
    change: Partial<CardRecord>,
    by: Provenance = this.actor,
  ): CardRecord {
    const lifecycle = change.lifecycle ??
      record.lifecycle ?? { revision: record.history.length, cycle: 0, noteStart: 0, stage: 'uninvestigated' }
    return {
      ...record,
      ...change,
      lifecycle: { ...lifecycle, revision: record.history.length + 1 },
      history: [
        ...record.history,
        {
          ...this.event(action, note),
          by,
          ...(action === 'closed' ? { proposal: record.proposal } : {}),
          ...(action === 'reopened' ? { closing: record.closing } : {}),
        },
      ],
    }
  }

  private event(action: CardEvent['action'], note: string | null): CardEvent {
    return { at: this.now(), action, note, by: this.actor }
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
