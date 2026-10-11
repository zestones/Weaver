import assert from 'node:assert/strict'
import { afterAll, test } from 'vitest'
import type { CardRegistry } from '../../src/registry/card-registry.ts'
import { RegistryError } from '../../src/registry/registry-error.ts'
import { FLAG_BODY, findingOf, flagOf, flagRecordOf, provenanceOf, writtenOf } from '../fixtures/cards.ts'
import { registriesIn } from '../fixtures/registries.ts'

const registries = registriesIn('joining')
const refused = (message: string) => (error: unknown) => error instanceof RegistryError && error.message === message
const last = (registry: CardRegistry, number: number) => {
  const event = registry.find(number)?.record.history.at(-1)

  return [event?.action, event?.note]
}

// 1: a written flag. 2: a raw flag, of another session. 3: a finding of a review. 4: a written flag.
function filled(): CardRegistry {
  const registry = registries.fresh()

  registry.flag(flagOf())
  registry.written(1, writtenOf())
  registry.flag(flagOf({ ...flagRecordOf(FLAG_BODY.replace('refresh()', 'renew()')), provenance: provenanceOf({ session: 'session-2' }) }))
  registry.open(findingOf())
  registry.flag(flagOf(flagRecordOf(FLAG_BODY.replace('refresh()', 'reload()'))))
  registry.written(4, writtenOf({ title: 'Nothing reloads the token' }))

  return registry
}

afterAll(() => {
  registries.discard()
})

test('two cards that may be the same thing are tied, each to the other, and stay two cards', () => {
  const registry = filled()

  registry.tie(1, 3, 'both about the token')
  registry.tie(4, 1, null)

  assert.deepEqual([registry.find(1)?.record.ties, registry.find(3)?.record.ties, registry.find(4)?.record.ties], [[3, 4], [1], [1]])
  assert.deepEqual(
    registry.list().map((card) => [card.number, card.state]),
    [
      [1, 'open'],
      [2, 'raw'],
      [3, 'open'],
      [4, 'open'],
    ],
  )
  assert.deepEqual(last(registry, 3), ['tied', 'to #1: both about the token'])
  assert.deepEqual(last(registry, 1), ['tied', 'to #4'])
})

test('a tie is undone on both cards', () => {
  const registry = filled()

  registry.tie(1, 3, null)
  registry.tie(1, 4, null)
  registry.untie(3, 1)

  assert.deepEqual([registry.find(1)?.record.ties, registry.find(3)?.record.ties, registry.find(4)?.record.ties], [[4], [], [1]])
  assert.deepEqual(last(registry, 1), ['untied', 'from #3'])
  assert.deepEqual(last(registry, 3), ['untied', 'from #1'])
})

test('a tie that cannot be made or undone is refused, and neither card is changed', () => {
  const registry = filled()

  registry.tie(1, 3, null)
  registry.merge(2, 4, 'the same thing')

  assert.throws(() => registry.tie(3, 1, null), refused('cards #3 and #1 are already tied'))
  assert.throws(() => registry.tie(1, 1, null), refused('card #1 cannot be tied to itself'))
  assert.throws(() => registry.tie(1, 2, null), refused('card #2 was merged into #4: tie that one'))
  assert.throws(() => registry.tie(1, 99, null), refused('no card has the number 99'))
  assert.throws(() => registry.untie(1, 4), refused('cards #1 and #4 are not tied'))
  assert.throws(() => registry.untie(99, 1), refused('no card has the number 99'))
  assert.deepEqual([registry.find(1)?.record.ties, registry.find(1)?.record.history.length], [[3], 3])
})

test('a card that is the same thing as another becomes an occurrence of it, and leaves the list', () => {
  const registry = filled()
  const into = registry.merge(2, 1, 'the same missing call')
  const from = registry.find(2)

  assert.deepEqual([into.number, into.state], [1, 'open'])
  assert.deepEqual(into.record.occurrences, [
    { card: 2, provenance: provenanceOf({ session: 'session-2' }), note: 'the same missing call' },
  ])
  assert.deepEqual([from?.state, from?.record.mergedInto, from?.record.flag?.text.includes('renew()')], ['merged', 1, true])
  assert.equal(into.record.seenSinceClosing, false)
  assert.deepEqual(last(registry, 1), ['seen-again', 'as card #2: the same missing call'])
  assert.deepEqual(last(registry, 2), ['merged', 'into #1: the same missing call'])
  assert.deepEqual(
    registry.list().map((card) => card.number),
    [1, 3, 4],
  )
  assert.deepEqual(registry.awaitingWriter(2), [])
})

test('a closed card that is seen again is marked, and is not opened again by itself', () => {
  const registry = filled()

  registry.closeCard(1, 'wontfix', 'wanted')

  const into = registry.merge(4, 1, 'the same thing, found again')

  assert.deepEqual([into.state, into.record.seenSinceClosing, into.record.closing?.as], ['closed', true, 'wontfix'])
  assert.match(into.oneLine(), /^#1 closed \(wontfix, seen again\)/)
  assert.equal(registry.merge(3, 1, 'again').record.occurrences.length, 2)
  assert.equal(
    registry.closeCard(registry.reopen(1, null).number, 'fixed', null).record.seenSinceClosing,
    false,
    'a new closing starts anew',
  )
})

test('a merge that cannot be made is refused, and nothing is changed', () => {
  const registry = filled()

  registry.merge(2, 1, 'the same thing')

  assert.throws(() => registry.merge(1, 1, 'itself'), refused('card #1 cannot be merged into itself'))
  assert.throws(() => registry.merge(2, 3, 'again'), refused('card #2 was merged into #1 already'))
  assert.throws(() => registry.merge(3, 2, 'into a merged one'), refused('card #2 was merged into #1: merge into that one'))
  assert.throws(() => registry.merge(3, 99, 'nowhere'), refused('no card has the number 99'))
  assert.throws(() => registry.merge(99, 3, 'nothing'), refused('no card has the number 99'))
  assert.deepEqual([registry.find(3)?.state, registry.find(1)?.record.occurrences.length], ['open', 1])
})

test('a merge is undone: the card is a card again as it was, and the other loses the occurrence', () => {
  const registry = filled()

  registry.closeCard(3, 'fixed', null)
  registry.merge(2, 1, 'the same thing')
  registry.merge(3, 1, 'the same thing')
  registry.merge(4, 1, 'the same thing')

  const raw = registry.separate(2)
  const closed = registry.separate(3)
  const open = registry.separate(4)

  assert.deepEqual([raw.state, raw.record.mergedInto], ['raw', null])
  assert.deepEqual([closed.state, closed.record.closing?.as], ['closed', 'fixed'])
  assert.deepEqual([open.state, open.title], ['open', 'Nothing reloads the token'])
  assert.deepEqual(registry.find(1)?.record.occurrences, [])
  assert.deepEqual(last(registry, 2), ['separated', 'from #1'])
  assert.deepEqual(last(registry, 1), ['separated', 'card #4 is another thing'])
  assert.deepEqual(
    registry.awaitingWriter(2).map((card) => card.number),
    [2],
  )
})

test('only a merged card is separated', () => {
  const registry = filled()

  assert.throws(() => registry.separate(1), refused('card #1 is not merged into another'))
  assert.throws(() => registry.separate(99), refused('no card has the number 99'))
})

test('a closed card that loses the only card seen since is no longer marked, and keeps the mark while another is left', () => {
  const registry = filled()

  registry.merge(2, 1, 'seen before the closing')
  registry.closeCard(1, 'wontfix', 'wanted')
  registry.merge(3, 1, 'seen since')
  registry.merge(4, 1, 'seen since, too')
  registry.separate(3)

  assert.deepEqual([registry.find(1)?.record.seenSinceClosing, registry.find(1)?.record.occurrences.length], [true, 2])

  registry.separate(4)

  assert.deepEqual([registry.find(1)?.record.seenSinceClosing, registry.find(1)?.record.occurrences.length], [false, 1])
})
