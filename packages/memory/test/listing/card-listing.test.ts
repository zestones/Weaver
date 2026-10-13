import assert from 'node:assert/strict'
import { test } from 'vitest'
import { Card } from '../../src/cards/card.ts'
import { CardListing } from '../../src/listing/card-listing.ts'
import { provenanceOf, recordOf, writtenOf } from '../fixtures/cards.ts'

const SCALE = ['critical', 'high', 'medium', 'low']
const cardOf = (number: number, labels: Readonly<Record<string, readonly string[]>>, at = '2026-10-11T10:00:00.000Z'): Card =>
  new Card(
    recordOf({ number, state: 'open', provenance: provenanceOf({ at }), written: writtenOf({ labels, title: `Card ${String(number)}` }) }),
  )
const cards = [
  cardOf(1, { level: ['low'], area: ['api'] }, '2026-10-10T08:00:00.000Z'),
  cardOf(2, { level: ['high'], area: ['api', 'database'] }),
  cardOf(3, { area: ['client'] }),
  cardOf(4, { level: ['critical'], area: ['database'] }, '2026-10-12T08:00:00.000Z'),
  cardOf(5, { level: ['high'], area: ['client'] }, '2026-10-12T09:00:00.000Z'),
]
const listing = new CardListing(cards, SCALE)
const numbers = (listed: readonly Card[]): number[] => listed.map((card) => card.number)

test('cards are put in order by the level the project grades them with, gravest first, then newest; or newest first', () => {
  assert.deepEqual(numbers(listing.ordered('level')), [4, 5, 2, 1, 3], 'a card without a level comes last')
  assert.deepEqual(numbers(listing.ordered('newest')), [5, 4, 3, 2, 1])
  assert.deepEqual(
    numbers(new CardListing(cards).ordered('level')),
    [5, 4, 3, 2, 1],
    'a project that grades nothing lists the newest first',
  )
  assert.deepEqual([listing.rankOf(cards[3] ?? cards[0]!), listing.rankOf(cards[2] ?? cards[0]!)], [0, 4])
})

test('a list is narrowed by labels: one of the values wanted in each family named', () => {
  const kept = (labels: Readonly<Record<string, readonly string[]>>): number[] => numbers(listing.narrowed({ labels }).ordered('newest'))

  assert.deepEqual(kept({ level: ['high', 'critical'] }), [5, 4, 2])
  assert.deepEqual(kept({ level: ['high', 'critical'], area: ['api', 'database'] }), [4, 2])
  assert.deepEqual(kept({ area: [] }), [5, 4, 3, 2, 1], 'a family with no value wanted narrows nothing')
  assert.deepEqual(kept({ type: ['bug'] }), [], 'no card of the list carries that family')
})

test('a list is narrowed to the cards made since a moment, to those someone concluded on, and to those that hold words', () => {
  const fixed = new Card({ ...cardOf(6, {}).record, notes: [{ provenance: provenanceOf(), conclusion: 'fixed', text: 'Paged in SQL.' }] })
  const all = new CardListing([...cards, fixed], SCALE)

  assert.deepEqual(numbers(listing.narrowed({ since: '2026-10-12T00:00:00.000Z' }).ordered('newest')), [5, 4])
  assert.deepEqual(numbers(all.narrowed({ answered: true }).cards), [6])
  assert.deepEqual(numbers(all.narrowed({ words: 'paged SQL' }).cards), [6], 'a note is part of what a card says')
  assert.deepEqual(numbers(all.narrowed({ words: 'CARD #4' }).cards), [4], 'in any letter case')
  assert.deepEqual(numbers(all.narrowed({ words: 'token.ts area:client' }).ordered('newest')), [5, 3], 'a place and a label are words too')
  assert.deepEqual(numbers(all.narrowed({ words: '   ' }).cards).length, 6)
})

test('the values of a family are counted over the cards of the list', () => {
  assert.deepEqual(listing.counts('level'), { low: 1, high: 2, critical: 1 })
  assert.deepEqual(listing.narrowed({ labels: { area: ['client'] } }).counts('level'), { high: 1 })
  assert.deepEqual(listing.counts('nothing'), {})
})

test('closed cards are put in order by how they were closed, the last closed first in each way, and narrowed to a way', () => {
  const closedOf = (number: number, as: 'fixed' | 'wontfix' | 'issue' | 'invalid', at: string, reason: string | null = null): Card =>
    new Card({
      ...cardOf(number, {}).record,
      state: 'closed',
      closing: { as, reason, issue: as === 'issue' ? 'https://issues.example/42' : null, at },
    })
  const closed = new CardListing([
    closedOf(1, 'wontfix', '2026-10-12T08:00:00.000Z', 'the token lives an hour'),
    closedOf(2, 'fixed', '2026-10-12T09:00:00.000Z'),
    closedOf(3, 'issue', '2026-10-12T10:00:00.000Z'),
    closedOf(4, 'fixed', '2026-10-13T09:00:00.000Z'),
    closedOf(5, 'invalid', '2026-10-13T10:00:00.000Z'),
    cardOf(6, {}),
  ])

  assert.deepEqual(numbers(closed.ordered('closing')), [4, 2, 1, 3, 5, 6], 'a card that is not closed comes after the closed ones')
  assert.deepEqual(
    closed.ordered('closing').map((card) => closed.closingRankOf(card)),
    [0, 0, 1, 2, 3, 4],
  )
  assert.deepEqual(numbers(closed.narrowed({ closedAs: ['wontfix', 'issue'] }).ordered('newest')), [3, 1])
  assert.deepEqual(numbers(closed.narrowed({ closedAs: [] }).cards).length, 6)
  assert.deepEqual(numbers(closed.narrowed({ words: 'lives an hour' }).cards), [1], 'the reason of a closing is part of what a card says')
  assert.deepEqual(numbers(closed.narrowed({ words: 'issues.example/42' }).cards), [3], 'and so is the issue it became')
  assert.deepEqual(numbers(closed.narrowed({ words: 'invalid' }).cards), [5])
})
