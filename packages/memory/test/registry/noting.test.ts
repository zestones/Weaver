import assert from 'node:assert/strict'
import { afterAll, test } from 'vitest'
import type { CardNote } from '../../src/cards/card-record.ts'
import type { CardRegistry } from '../../src/registry/card-registry.ts'
import { RegistryError } from '../../src/registry/registry-error.ts'
import { FLAG_BODY, findingOf, flagOf, flagRecordOf, provenanceOf, writtenOf } from '../fixtures/cards.ts'
import { registriesIn } from '../fixtures/registries.ts'

const registries = registriesIn('noting')
const refused = (message: string) => (error: unknown) => error instanceof RegistryError && error.message === message
const OWNER = provenanceOf({ author: 'owner', role: 'owner', session: null, unit: null, requests: [] })
// Notes are told apart by their moment: each one of a test is written a minute after the one before.
let minute = 0

function noteOf(fields: Partial<CardNote> = {}): CardNote {
  minute += 1

  return {
    provenance: provenanceOf({ session: 'session-2', unit: 4, at: new Date(Date.UTC(2020, 0, 1, 0, minute)).toISOString() }),
    conclusion: null,
    text: 'Ran the test of the token: it fails after an hour.',
    ...fields,
  }
}

// 1: a written flag. 2: a finding of a review.
function filled(): CardRegistry {
  const registry = registries.fresh()

  registry.flag(flagOf())
  registry.written(1, writtenOf())
  registry.open(findingOf())

  return registry
}

afterAll(() => {
  registries.discard()
})

test('what is found about a card is written on it, in order, and the card stays as it stood', () => {
  const registry = filled()
  const first = registry.note(1, noteOf({ text: '  Ran the test of the token: it fails after an hour.\n' }))
  const second = registry.note(1, noteOf({ provenance: OWNER, text: 'To fix with the session store.' }))

  assert.deepEqual([first.known, second.known, second.card.state], [false, false, 'open'])
  assert.deepEqual(
    second.card.record.notes.map(({ provenance, conclusion, text }) => [provenance.role, conclusion, text]),
    [
      ['author', null, 'Ran the test of the token: it fails after an hour.'],
      ['owner', null, 'To fix with the session store.'],
    ],
  )
  assert.deepEqual(registry.find(1)?.record.history.slice(-2), [
    { at: registry.find(1)?.record.history.at(-2)?.at, action: 'noted', note: null },
    { at: registry.find(1)?.record.history.at(-1)?.at, action: 'noted', note: null },
  ])
  assert.deepEqual(registry.note(2, noteOf()).card.record.notes.length, 1, 'a card that comes from a review is written on too')
})

test('the last conclusion written on a card is how it stands, until the owner decides', () => {
  const registry = filled()

  assert.deepEqual([registry.find(1)?.conclusion, registry.find(1)?.standing], [null, 'open'])

  registry.note(1, noteOf({ conclusion: 'unsure' }))
  const confirmed = registry.note(1, noteOf({ conclusion: 'confirmed', text: 'Reproduced with a token of one second.' })).card

  assert.deepEqual(
    [confirmed.conclusion?.as, confirmed.conclusion?.by.session, confirmed.standing],
    ['confirmed', 'session-2', 'open (confirmed)'],
  )
  assert.equal(confirmed.oneLine(), '#1 open (confirmed)  src/auth/token.ts:42  Nothing refreshes the token')
  assert.equal(registry.note(1, noteOf({ text: 'A word of the owner.', provenance: OWNER })).card.standing, 'open (confirmed)')
  assert.equal(registry.note(1, noteOf({ conclusion: 'fixed' })).card.standing, 'open (fixed)')
  assert.equal(registry.closeCard(1, 'fixed', null).standing, 'closed (fixed)')
  assert.deepEqual(registry.find(1)?.record.history.at(-2)?.note, 'fixed')
})

test('a card that is opened again is to be looked into again: what was concluded before no longer stands', () => {
  const registry = filled()

  registry.note(1, noteOf({ conclusion: 'fixed' }))
  registry.closeCard(1, 'fixed', null)

  const reopened = registry.reopen(1, 'it came back')

  assert.deepEqual([reopened.standing, reopened.conclusion, reopened.record.notes.length], ['open', null, 1])
  assert.equal(
    registry.note(1, { ...noteOf({ conclusion: 'refuted' }), provenance: provenanceOf({ at: '2999-01-01T00:00:00.000Z' }) }).card.standing,
    'open (refuted)',
  )
})

test('a flag that says its author fixed the thing is the first conclusion of its card', () => {
  const registry = registries.fresh()
  const { card } = registry.flag(flagOf(flagRecordOf(FLAG_BODY.replace('left as it is.', 'fixed in the task: the task could not go on.'))))

  assert.deepEqual([card.conclusion?.as, card.conclusion?.by.author, card.standing], ['fixed', 'claude', 'raw (fixed)'])
  assert.equal(registry.written(1, writtenOf()).standing, 'open (fixed)')
  assert.equal(
    registry.note(1, noteOf({ conclusion: 'confirmed', text: 'The fix holds, and the rest is still there.' })).card.standing,
    'open (confirmed)',
  )

  registry.closeCard(1, 'fixed', null)

  assert.equal(registry.reopen(1, null).standing, 'open')
})

test('a note that the hook sees twice is written once, and the owner may say the same words another day', () => {
  const registry = filled()
  const note = noteOf({ conclusion: 'confirmed' })

  registry.note(1, note)

  assert.deepEqual([registry.note(1, note).known, registry.find(1)?.record.notes.length], [true, 1])
  assert.equal(registry.note(1, { ...note, conclusion: 'refuted' }).known, false)
  assert.equal(registry.note(1, { ...note, provenance: provenanceOf({ session: 'session-2', unit: 5 }) }).known, false)
  assert.equal(registry.note(1, { ...note, provenance: OWNER }).known, false)
  assert.equal(registry.note(1, { ...note, provenance: OWNER }).known, false)
  assert.equal(registry.find(1)?.record.notes.length, 5)
})

test('a note is written on a closed card, and not on a merged one, an empty one or a number nobody has', () => {
  const registry = filled()

  registry.flag(flagOf(flagRecordOf(FLAG_BODY.replace('refresh()', 'renew()'))))
  registry.merge(3, 1, 'the same thing')
  registry.closeCard(2, 'wontfix', 'wanted')

  assert.deepEqual(
    [registry.note(2, noteOf({ conclusion: 'confirmed' })).card.standing, registry.find(2)?.record.notes.length],
    ['closed (wontfix)', 1],
  )
  assert.throws(() => registry.note(3, noteOf()), refused('card #3 was merged into #1: write on that one'))
  assert.throws(() => registry.note(1, noteOf({ text: ' \n ' })), refused('a note says something: this one is empty'))
  assert.throws(() => registry.note(9, noteOf()), refused('no card has the number 9'))
  assert.equal(registry.find(1)?.record.notes.length, 0)
})
