import assert from 'node:assert/strict'
import { afterAll, test } from 'vitest'
import type { CardRegistry } from '../../src/registry/card-registry.ts'
import { RegistryError } from '../../src/registry/registry-error.ts'
import { FLAG_BODY, findingOf, flagOf, flagRecordOf, writtenOf } from '../fixtures/cards.ts'
import { registriesIn } from '../fixtures/registries.ts'

const registries = registriesIn('deciding')
const refused = (message: string) => (error: unknown) => error instanceof RegistryError && error.message === message
const actions = (registry: CardRegistry, number: number) => registry.find(number)?.record.history.map(({ action, note }) => [action, note])

// 1: a written flag. 2: a raw flag. 3: a finding of a review.
function filled(): CardRegistry {
  const registry = registries.fresh()

  registry.flag(flagOf())
  registry.written(1, writtenOf())
  registry.flag(flagOf(flagRecordOf(FLAG_BODY.replace('refresh()', 'renew()'))))
  registry.open(findingOf())

  return registry
}

afterAll(() => {
  registries.discard()
})

test('the owner closes a card as fixed, wontfix or issue, with a reason, and it no longer waits', () => {
  const registry = filled()
  const fixed = registry.closeCard(1, 'fixed', null)
  const wontfix = registry.closeCard(2, 'wontfix', '  The token lives an hour.  ')
  const issue = registry.closeCard(3, 'issue', 'worth a ticket', 'https://example.com/issues/3')

  assert.deepEqual([fixed.state, fixed.isWaiting, fixed.record.closing?.as, fixed.record.closing?.reason], ['closed', false, 'fixed', null])
  assert.deepEqual(
    [wontfix.state, wontfix.record.closing?.reason, wontfix.record.closing?.issue],
    ['closed', 'The token lives an hour.', null],
  )
  assert.deepEqual([issue.record.closing?.as, issue.record.closing?.issue], ['issue', 'https://example.com/issues/3'])
  assert.match(fixed.record.closing?.at ?? '', /^\d{4}-\d\d-\d\dT[\d:.]+Z$/)
  assert.deepEqual(registry.list(), [])
  assert.deepEqual(actions(registry, 2), [
    ['flagged', null],
    ['closed', 'wontfix: The token lives an hour.'],
  ])
  assert.deepEqual(registry.awaitingWriter(2), [], 'a raw flag that is closed is not written up')
})

test('closing as wontfix needs a reason, and the card stays as it was without one', () => {
  const registry = filled()

  assert.throws(() => registry.closeCard(1, 'wontfix', null), refused('closing card #1 as wontfix needs a reason'))
  assert.throws(() => registry.closeCard(1, 'wontfix', '   '), refused('closing card #1 as wontfix needs a reason'))
  assert.deepEqual([registry.find(1)?.state, registry.find(1)?.record.closing], ['open', null])
})

test('a card that is closed or merged, or a number nobody has, cannot be closed, and the error says why', () => {
  const registry = filled()

  registry.closeCard(1, 'wontfix', 'wanted')
  registry.merge(2, 3, 'the same cast')

  assert.throws(() => registry.closeCard(1, 'fixed', null), refused('card #1 is already closed as wontfix'))
  assert.throws(() => registry.closeCard(2, 'fixed', null), refused('card #2 was merged into #3: close that one'))
  assert.throws(() => registry.closeCard(99, 'fixed', null), refused('no card has the number 99'))
  assert.equal(registry.find(1)?.record.closing?.as, 'wontfix')
})

test('a closed card is opened again as what it was: a written one open, a flag nobody wrote up raw', () => {
  const registry = filled()

  registry.closeCard(1, 'fixed', null)
  registry.closeCard(2, 'wontfix', 'wanted')
  registry.merge(3, 1, 'the same thing')

  const written = registry.reopen(1, 'it came back')
  const raw = registry.reopen(2, null)

  assert.deepEqual([written.state, written.record.closing, written.record.seenSinceClosing], ['open', null, false])
  assert.deepEqual([raw.state, raw.record.closing], ['raw', null])
  assert.deepEqual(actions(registry, 2)?.slice(-2), [
    ['closed', 'wontfix: wanted'],
    ['reopened', null],
  ])
  assert.deepEqual(actions(registry, 1)?.at(-1), ['reopened', 'it came back'])
  assert.deepEqual(
    registry.list().map((card) => card.number),
    [1, 2],
  )
  assert.deepEqual(
    registry.awaitingWriter(2).map((card) => card.number),
    [2],
  )
})

test('only a closed card is opened again', () => {
  const registry = filled()

  registry.merge(2, 1, 'the same thing')

  assert.throws(() => registry.reopen(1, null), refused('card #1 is not closed: it is open'))
  assert.throws(() => registry.reopen(2, null), refused('card #2 was merged into #1: separate it to have it back'))
  assert.throws(() => registry.reopen(99, null), refused('no card has the number 99'))
})

test('a written card is corrected in its title, its labels or its sections, and keeps the rest', () => {
  const registry = filled()
  const sections = [{ name: 'Observation', text: 'Nothing calls it.' }]
  const titled = registry.correct(1, { title: '  The token is never refreshed ' })
  const relabelled = registry.correct(1, { labels: { type: ['debt'] }, sections })

  assert.deepEqual([titled.title, titled.labels()], ['The token is never refreshed', ['type:bug', 'area:auth']])
  assert.deepEqual(
    [relabelled.title, relabelled.labels(), relabelled.record.written?.sections],
    ['The token is never refreshed', ['type:debt'], sections],
  )
  assert.deepEqual(relabelled.record.written?.look, writtenOf().look)
  assert.deepEqual(actions(registry, 1)?.slice(-2), [
    ['corrected', 'title'],
    ['corrected', 'labels, sections'],
  ])
  assert.deepEqual(
    [
      registry.list({ label: 'type:debt' }).length,
      registry.list({ label: 'type:bug' }).length,
      registry.list({ label: 'area:auth' }).length,
    ],
    [1, 0, 0],
  )
})

test('a card the writer did not write, an empty correction and an empty title are refused', () => {
  const registry = filled()
  const unwritten = 'has no title, labels or sections to correct: the writer did not write it'

  assert.throws(() => registry.correct(2, { title: 'A title' }), refused(`card #2 ${unwritten}`))
  assert.throws(() => registry.correct(3, { title: 'A title' }), refused(`card #3 ${unwritten}`))
  assert.throws(() => registry.correct(1, {}), refused('a correction gives a title, labels or sections: this one gives none'))
  assert.throws(() => registry.correct(1, { title: '  ' }), refused('the title of a card cannot be empty'))
  assert.throws(() => registry.correct(99, { title: 'A title' }), refused('no card has the number 99'))
  assert.equal(registry.find(1)?.title, 'Nothing refreshes the token')
})
