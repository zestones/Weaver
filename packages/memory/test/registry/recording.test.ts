import assert from 'node:assert/strict'
import { afterAll, test } from 'vitest'
import { contextOf, FLAG_BODY, findingOf, flagOf, flagRecordOf, provenanceOf } from '../fixtures/cards.ts'
import { registriesIn } from '../fixtures/registries.ts'

const registries = registriesIn('recording')
const OTHER_BODY = FLAG_BODY.replace('refresh()', 'renew()')

afterAll(() => {
  registries.discard()
})

test('a flag becomes a raw card under the next number, with its places, its context and where it comes from', () => {
  const registry = registries.fresh()
  const first = registry.flag(flagOf({ callId: 'call-1', context: [contextOf()] }))
  const second = registry.flag(flagOf({ callId: 'call-2', places: [], ...flagRecordOf(OTHER_BODY) }))
  const { record } = first.card

  assert.deepEqual([first.known, first.card.number, second.known, second.card.number], [false, 1, false, 2])
  assert.deepEqual([record.origin, record.state, record.written, record.review, record.closing], ['flag', 'raw', null, null, null])
  assert.deepEqual(record.places, [{ file: 'src/auth/token.ts', line: 42 }])
  assert.deepEqual(record.provenance, provenanceOf())
  assert.deepEqual(record.flag?.context, [contextOf()])
  assert.deepEqual(record.writing, { attempts: 0, failure: null })
  assert.deepEqual(
    record.history.map(({ action, note }) => [action, note]),
    [['flagged', null]],
  )
  assert.deepEqual(second.card.places, [])
})

test('a card keeps its flag word for word, and the fields read from it', () => {
  const body = `${FLAG_BODY}\n\n   trailing lines, kept as they are\n`
  const { card } = registries.fresh().flag(flagOf(flagRecordOf(body)))

  assert.equal(card.record.flag?.text, body)
  assert.equal(card.record.flag?.fields.did, 'left')
  assert.equal(card.record.flag?.fields.seen, 'no call of refresh() exists under src/.')
})

test('a flag of the owner is a card whose origin is the owner', () => {
  const owner = provenanceOf({ author: 'owner', role: 'owner', session: null, unit: null, requests: [] })

  assert.equal(registries.fresh().flag(flagOf({ provenance: owner })).card.origin, 'owner')
})

test('the same tool call records one flag, however many times it is sent', () => {
  const registry = registries.fresh()
  const first = registry.flag(flagOf({ callId: 'call-1' }))
  const again = registry.flag(flagOf({ callId: 'call-1', ...flagRecordOf(OTHER_BODY), provenance: provenanceOf({ session: 'session-2' }) }))

  assert.deepEqual([again.known, again.card.number], [true, first.card.number])
  assert.equal(again.card.record.flag?.text, FLAG_BODY, 'what was recorded is never rewritten')
  assert.equal(registry.list().length, 1)
})

test('the same text in the same session and unit is the same flag, whatever call sent it', () => {
  const registry = registries.fresh()
  const first = registry.flag(flagOf({ callId: 'call-1' }))
  const retried = registry.flag(flagOf({ callId: 'call-2', places: [{ file: 'src/other.ts', line: null }] }))
  const outside = registry.flag(flagOf({ callId: 'call-3', provenance: provenanceOf({ unit: null }) }))
  const outsideAgain = registry.flag(flagOf({ callId: 'call-4', provenance: provenanceOf({ unit: null }) }))

  assert.deepEqual([retried.known, retried.card.number], [true, first.card.number])
  assert.deepEqual([outside.known, outsideAgain.known, outsideAgain.card.number], [false, true, outside.card.number])
  assert.equal(registry.list().length, 2)
})

test('the same text in another session, in another unit, or from the owner without a session, is another flag', () => {
  const registry = registries.fresh()
  const owner = provenanceOf({ author: 'owner', role: 'owner', session: null, unit: null })
  const flags = [
    registry.flag(flagOf()),
    registry.flag(flagOf({ provenance: provenanceOf({ session: 'session-2' }) })),
    registry.flag(flagOf({ provenance: provenanceOf({ unit: 2 }) })),
    registry.flag(flagOf(flagRecordOf(OTHER_BODY))),
    registry.flag(flagOf({ provenance: owner })),
    registry.flag(flagOf({ provenance: owner })),
  ]

  assert.deepEqual(
    flags.map(({ known, card }) => [known, card.number]),
    [1, 2, 3, 4, 5, 6].map((number) => [false, number]),
  )
})

test('a finding or a suspicion of a review is an open card at once, which keeps what the review said', () => {
  const registry = registries.fresh()
  const finding = registry.open(findingOf())
  const suspicion = registry.open(
    findingOf({ review: '3f9a2c1/S1', rule: null, statement: null, message: 'The retry may loop.' }, { origin: 'suspicion', places: [] }),
  )

  assert.deepEqual([finding.number, finding.state, finding.origin, finding.isWaiting], [1, 'open', 'finding', true])
  assert.deepEqual([suspicion.number, suspicion.state, suspicion.origin], [2, 'open', 'suspicion'])
  assert.deepEqual(finding.record.review, findingOf().content)
  assert.deepEqual([finding.record.flag, finding.record.written], [null, null])
  assert.deepEqual(finding.record.provenance, provenanceOf({ author: 'codex', role: 'reviewer' }))
  assert.deepEqual(
    finding.record.history.map(({ action }) => action),
    ['opened'],
  )
  assert.deepEqual(registry.awaitingWriter(2), [], 'the writer is not involved')
})

test('the same rule at the same place as a card that waits is an occurrence of that card, not a new one', () => {
  const registry = registries.fresh()
  const first = registry.open(findingOf())
  const later = provenanceOf({ author: 'claude', role: 'reviewer', session: 'session-2', at: '2026-10-12T09:00:00.000Z' })
  const again = registry.open(findingOf({ review: '9c8b7a6/F2', message: 'Still cast, in other words.' }, { provenance: later }))

  assert.equal(again.number, first.number)
  assert.equal(registry.list().length, 1)
  assert.deepEqual(again.record.occurrences, [{ card: null, provenance: later, note: '9c8b7a6/F2: Still cast, in other words.' }])
  assert.equal(again.record.review?.review, '3f9a2c1/F1', 'the card keeps what was said first')
  assert.deepEqual(
    again.record.history.map(({ action, note }) => [action, note]),
    [
      ['opened', null],
      ['seen-again', '9c8b7a6/F2'],
    ],
  )
})

test('another rule, another place, or a card that no longer waits, makes a new card', () => {
  const registry = registries.fresh()
  const first = registry.open(findingOf())
  const otherRule = registry.open(findingOf({ review: 'a/F1', rule: 'N1' }))
  const otherLine = registry.open(findingOf({ review: 'a/F2' }, { places: [{ file: 'src/api/user.ts', line: 8 }] }))

  registry.closeCard(first.number, 'fixed', null)

  const afterClosing = registry.open(findingOf({ review: 'a/F3' }))

  assert.deepEqual([first.number, otherRule.number, otherLine.number, afterClosing.number], [1, 2, 3, 4])
  assert.deepEqual(registry.find(1)?.record.occurrences, [])
})

test('a suspicion, or a finding without a place, is the same thing only when it says the same', () => {
  const registry = registries.fresh()
  const suspicion = (review: string, message: string) =>
    registry.open(
      findingOf(
        { review, rule: null, statement: null, message },
        { origin: 'suspicion', places: [{ file: 'src/api/user.ts', line: null }] },
      ),
    )
  const nowhere = (review: string, message: string) => registry.open(findingOf({ review, message }, { places: [] }))

  assert.deepEqual(
    [
      suspicion('a/S1', 'The retry may loop.').number,
      suspicion('a/S2', 'The cache may be stale.').number,
      suspicion('b/S1', 'the retry   may loop.').number,
    ],
    [1, 2, 1],
  )
  assert.deepEqual([nowhere('a/F1', 'No test.').number, nowhere('a/F2', 'No docs.').number, nowhere('b/F1', 'No test.').number], [3, 4, 3])
  assert.equal(registry.find(1)?.record.occurrences.length, 1)
})

test('the same point of the same review sent twice is taken once, even after its card was closed', () => {
  const registry = registries.fresh()
  const first = registry.open(findingOf())

  registry.open(findingOf({ review: '9c8b7a6/F2' }))
  registry.open(findingOf({ review: '9c8b7a6/F2' }))
  assert.equal(registry.open(findingOf()).record.occurrences.length, 1)

  registry.closeCard(first.number, 'wontfix', 'wanted')

  const resent = registry.open(findingOf())

  assert.deepEqual([resent.number, resent.state, registry.list({ states: ['raw', 'open', 'closed'] }).length], [1, 'closed', 1])
})
