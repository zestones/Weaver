import assert from 'node:assert/strict'
import { afterAll, test } from 'vitest'
import type { Card } from '../../src/cards/card.ts'
import type { CardRegistry } from '../../src/registry/card-registry.ts'
import { FLAG_BODY, findingOf, flagOf, flagRecordOf, provenanceOf, writtenOf } from '../fixtures/cards.ts'
import { registriesIn } from '../fixtures/registries.ts'

const registries = registriesIn('listing')
const numbers = (cards: readonly Card[]): number[] => cards.map((card) => card.number)
const body = (word: string): string => FLAG_BODY.replace('refresh()', word)

// 1: a raw flag on token.ts. 2: a written flag on token.ts and session.ts, labelled. 3: a finding on user.ts.
// 4: a closed flag on session.ts, of another session. 5: a flag of the owner, without a place. 6: merged into 2.
function filled(): CardRegistry {
  const registry = registries.fresh()
  const session = { file: 'src/auth/session.ts', line: null }

  registry.flag(flagOf(flagRecordOf(body('one()'))))
  registry.flag(flagOf({ places: [{ file: 'src/auth/token.ts', line: 7 }, session], ...flagRecordOf(body('two()')) }))
  registry.written(2, writtenOf({ labels: { type: ['bug'], area: ['auth', 'api'] } }))
  registry.open(findingOf())
  registry.flag(flagOf({ places: [session], ...flagRecordOf(body('four()')), provenance: provenanceOf({ session: 'session-2', unit: 3 }) }))
  registry.closeCard(4, 'fixed', null)
  registry.flag(flagOf({ places: [], provenance: provenanceOf({ author: 'owner', role: 'owner', session: null, unit: null }) }))
  registry.flag(flagOf({ places: [session], ...flagRecordOf(body('six()')) }))
  registry.merge(6, 2, 'the same missing call')

  return registry
}

afterAll(() => {
  registries.discard()
})

test('a card is found by its number, and a number nobody has finds nothing', () => {
  const registry = filled()

  assert.equal(registry.find(3)?.origin, 'finding')
  assert.equal(registry.find(6)?.state, 'merged')
  assert.equal(registry.find(99), null)
  assert.equal(registry.find(0), null)
})

test('the list is the cards that wait, raw and open, in the order they came', () => {
  assert.deepEqual(numbers(filled().list()), [1, 2, 3, 5])
  assert.deepEqual(registries.fresh().list(), [])
})

test('the list is narrowed to the states asked for', () => {
  const registry = filled()

  assert.deepEqual(numbers(registry.list({ states: ['raw'] })), [1, 5])
  assert.deepEqual(numbers(registry.list({ states: ['closed'] })), [4])
  assert.deepEqual(numbers(registry.list({ states: ['merged', 'closed'] })), [4, 6])
  assert.deepEqual(numbers(registry.list({ states: ['raw', 'open', 'closed', 'merged'] })), [1, 2, 3, 4, 5, 6])
  assert.deepEqual(numbers(registry.list({ states: [] })), [])
})

test('the list is narrowed to a file, a label, an origin, a session or a unit, and to several of them at once', () => {
  const registry = filled()
  const all = { states: ['raw', 'open', 'closed', 'merged'] } as const

  assert.deepEqual(numbers(registry.list({ file: 'src/auth/token.ts' })), [1, 2])
  assert.deepEqual(numbers(registry.list({ file: 'src/auth/session.ts' })), [2])
  assert.deepEqual(numbers(registry.list({ ...all, file: 'src/auth/session.ts' })), [2, 4, 6])
  assert.deepEqual(numbers(registry.list({ file: 'src/auth' })), [], 'a file, not what is under a folder')
  assert.deepEqual(numbers(registry.list({ label: 'area:api' })), [2])
  assert.deepEqual(numbers(registry.list({ label: 'area:web' })), [])
  assert.deepEqual(numbers(registry.list({ label: 'api' })), [], 'a label is a family and a value')
  assert.deepEqual(numbers(registry.list({ origin: 'finding' })), [3])
  assert.deepEqual(numbers(registry.list({ origin: 'owner' })), [5])
  assert.deepEqual(numbers(registry.list({ origin: 'flag' })), [1, 2])
  assert.deepEqual(numbers(registry.list({ session: 'session-1' })), [1, 2, 3])
  assert.deepEqual(numbers(registry.list({ ...all, session: 'session-2' })), [4])
  assert.deepEqual(numbers(registry.list({ ...all, unit: 3 })), [4])
  assert.deepEqual(
    numbers(registry.list({ session: 'session-1', unit: 1, origin: 'flag', file: 'src/auth/token.ts', label: 'type:bug' })),
    [2],
  )
  assert.deepEqual(numbers(registry.list({ session: 'session-1', unit: 2 })), [])
})

test('what is known about files is every card that names one of them, closed or not, newest first, without the merged ones', () => {
  const registry = filled()

  assert.deepEqual(numbers(registry.about(['src/auth/session.ts'])), [4, 2])
  assert.deepEqual(numbers(registry.about(['src/auth/token.ts', 'src/api/user.ts', 'src/unknown.ts'])), [3, 2, 1])
  assert.deepEqual(
    numbers(registry.about(['src/auth/token.ts', 'src/auth/session.ts'])),
    [4, 2, 1],
    'a card that names two of them comes once',
  )
  assert.deepEqual(registry.about(['src/unknown.ts']), [])
  assert.deepEqual(registry.about([]), [])
})
