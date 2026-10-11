import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { afterAll, test } from 'vitest'
import type { CardRegistry } from '../../src/registry/card-registry.ts'
import { RegistryError } from '../../src/registry/registry-error.ts'
import { FLAG_BODY, findingOf, flagOf, flagRecordOf, writtenOf } from '../fixtures/cards.ts'
import { registriesIn } from '../fixtures/registries.ts'

const registries = registriesIn('writer-side')
const refused = (message: string) => (error: unknown) => error instanceof RegistryError && error.message === message
const awaiting = (registry: CardRegistry, maxAttempts = 2) => registry.awaitingWriter(maxAttempts).map((card) => card.number)

// 1 and 2: raw flags. 3: a finding of a review.
function filled(): CardRegistry {
  const registry = registries.fresh()

  registry.flag(flagOf())
  registry.flag(flagOf(flagRecordOf(FLAG_BODY.replace('refresh()', 'renew()'))))
  registry.open(findingOf())

  return registry
}

function deadProcess(): number {
  return spawnSync(process.execPath, ['-e', '']).pid
}

afterAll(() => {
  registries.discard()
})

test('the writer is given the flags nobody wrote up, in the order they came, and never a card that comes from a review', () => {
  const registry = filled()

  assert.deepEqual(awaiting(registry), [1, 2])

  registry.written(1, writtenOf())

  assert.deepEqual(awaiting(registry), [2])
  assert.deepEqual(awaiting(registries.fresh()), [])
})

test('a flag that is written up is an open card, with what the writer made of it and its labels to find it by', () => {
  const registry = filled()
  const card = registry.written(1, writtenOf())

  assert.deepEqual([card.state, card.title, card.labels()], ['open', 'Nothing refreshes the token', ['type:bug', 'area:auth']])
  assert.deepEqual(card.record.written, writtenOf())
  assert.equal(card.record.flag?.text, FLAG_BODY, 'the flag is kept beside what was made of it')
  assert.deepEqual(card.record.history.at(-1)?.action, 'written')
  assert.deepEqual(
    registry.list({ label: 'area:auth' }).map((found) => found.number),
    [1],
  )
})

test('a flag the writer failed on stays raw with the reason, and counts one more attempt', () => {
  const registry = filled()
  const once = registry.writingFailed(1, 'no answer after 600 s')

  assert.deepEqual([once.state, once.record.writing], ['raw', { attempts: 1, failure: 'no answer after 600 s' }])
  assert.deepEqual([once.record.history.at(-1)?.action, once.record.history.at(-1)?.note], ['writing-failed', 'no answer after 600 s'])
  assert.deepEqual(awaiting(registry), [1, 2])

  const twice = registry.writingFailed(1, 'the card of the writer has no title')

  assert.deepEqual(twice.record.writing, { attempts: 2, failure: 'the card of the writer has no title' })
  assert.deepEqual(awaiting(registry), [2], 'no more than the attempts allowed')
  assert.deepEqual(awaiting(registry, 3), [1, 2])
})

test('a flag written up after a failure keeps its attempts and forgets the failure', () => {
  const registry = filled()

  registry.writingFailed(1, 'no answer after 600 s')

  assert.deepEqual(registry.written(1, writtenOf()).record.writing, { attempts: 1, failure: null })
})

test('a flag closed while the writer worked gains its card and stays closed', () => {
  const registry = filled()

  registry.closeCard(1, 'wontfix', 'wanted')

  const card = registry.written(1, writtenOf())

  assert.deepEqual([card.state, card.title, card.record.closing?.as], ['closed', 'Nothing refreshes the token', 'wontfix'])
  assert.equal(registry.reopen(1, null).state, 'open')
})

test('the writer writes a flag once, and writes nothing for a card that comes from a review or does not exist', () => {
  const registry = filled()

  registry.written(1, writtenOf())

  assert.throws(() => registry.written(1, writtenOf()), refused('card #1 is already written'))
  assert.throws(() => registry.written(3, writtenOf()), refused('card #3 comes from a review: the writer has nothing to write'))
  assert.throws(() => registry.written(99, writtenOf()), refused('no card has the number 99'))
  assert.throws(() => registry.writingFailed(99, 'nothing'), refused('no card has the number 99'))
})

test('one writer at a time: the turn is refused while a living process holds it, and given once that process leaves', () => {
  const registry = filled()
  const other = process.ppid

  assert.equal(registry.takeWriterTurn(other), true)
  assert.equal(registry.takeWriterTurn(process.pid), false)
  assert.equal(registry.takeWriterTurn(other), true, 'the one that holds it is told again that it does')

  registry.leaveWriterTurn(process.pid)

  assert.equal(registry.takeWriterTurn(process.pid), false, 'only the one that holds the turn leaves it')

  registry.leaveWriterTurn(other)

  assert.equal(registry.takeWriterTurn(process.pid), true)
})

test('the turn of a writer whose process is dead is taken', () => {
  const registry = filled()
  const dead = deadProcess()

  assert.equal(registry.takeWriterTurn(dead), true)
  assert.equal(registry.takeWriterTurn(process.pid), true)
  assert.equal(registry.takeWriterTurn(process.ppid), false, 'and it is held by the one that took it')
})
