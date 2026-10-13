import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NoteText } from '@weaver/memory'
import { afterAll, beforeEach, test } from 'vitest'
import { Session } from '../../src/unit-of-work/session/session.ts'
import { cardsOf, FLAG_BODY, flagCommand, withRegistry } from '../fixtures/cards.ts'
import { git, makeRepo, SAMPLE_REPO } from '../fixtures/repo.ts'
import { A_FILE, bashCall, eventsOf, prompt, refusalOf, stateOf } from '../fixtures/session.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-notes-'))
const WRITTEN = (card: number): string =>
  `[weaver] Note written on card ${String(card)} for the owner. This command is answered here and never runs: that is expected. Go on with your task.`
const REPORT = 'Ran the test with a token of one second:\n\n    401 Unauthorized\n'
let session: Session
let counter = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  session = new Session(makeRepo(join(scratch, `repo-${String(counter)}`), SAMPLE_REPO), 's', 'claude')
  refusalOf(session, bashCall(flagCommand([A_FILE])))
})

const note = (words: string, body: string | null = REPORT) => bashCall(`weaver note ${words}${body === null ? '' : ` <<'EOF'\n${body}EOF`}`)
const notesOf = () => eventsOf(session, 'note').map(({ unit, card, conclusion }) => ({ unit, card, conclusion }))

test('a note is answered in place of its command: it is written on its card with who wrote it, and the session journals it', () => {
  prompt(session, 'verify card 1')

  const reason = refusalOf(session, note('1 confirmed'))
  const [card] = cardsOf(session.repo)
  const [written] = card?.record.notes ?? []

  assert.equal(reason, WRITTEN(1))
  assert.deepEqual([written?.conclusion, written?.text], ['confirmed', REPORT.trim()])
  assert.deepEqual(
    { ...written?.provenance, at: null },
    {
      author: 'claude',
      role: 'author',
      session: 's',
      subagent: null,
      unit: 1,
      requests: ['verify card 1'],
      commit: git(session.repo.top, ['rev-parse', 'HEAD']),
      at: null,
    },
  )
  assert.deepEqual([card?.state, card?.standing], ['raw', 'raw (confirmed)'])
  assert.deepEqual(notesOf(), [{ unit: 1, card: 1, conclusion: 'confirmed' }])
  assert.deepEqual(stateOf(session)?.pending, {}, 'a command that never runs writes nothing to watch')
})

test('a note says its text on its line too, concludes nothing when it gives no word, and a subagent writes under its own id', () => {
  assert.equal(refusalOf(session, { ...note('1 "the same cache as in the store"', null), agent_id: 'a406db5d5f6bb15fe' }), WRITTEN(1))

  const [written] = cardsOf(session.repo)[0]?.record.notes ?? []

  assert.deepEqual(
    [written?.conclusion, written?.text, written?.provenance.subagent],
    [null, 'the same cache as in the store', 'a406db5d5f6bb15fe'],
  )
  assert.deepEqual(notesOf(), [{ unit: 1, card: 1, conclusion: null }])
})

test('a call that writes on several cards, and flags too, is answered for each: nothing an agent said in it is lost', () => {
  refusalOf(session, bashCall(flagCommand([A_FILE], FLAG_BODY.replace('refresh()', 'renew()'))))

  const command = [
    `weaver note 1 confirmed <<'EOF'\n${REPORT}EOF`,
    'echo "exit $?"',
    `weaver note 2 refuted <<'EOF'\nrenew() is called by the scheduler.\nEOF`,
    flagCommand([A_FILE], FLAG_BODY.replace('refresh()', 'rotate()')),
  ].join('\n')

  assert.equal(
    refusalOf(session, bashCall(command)),
    [
      '[weaver] Flag 3 recorded for the owner. This command is answered here and never runs: that is expected. Go on with your task.',
      WRITTEN(1),
      WRITTEN(2),
    ].join('\n'),
  )
  assert.deepEqual(
    cardsOf(session.repo).map((card) => [card.number, card.standing, card.record.notes.map((written) => written.text)]),
    [
      [1, 'raw (confirmed)', [REPORT.trim()]],
      [2, 'raw (refuted)', ['renew() is called by the scheduler.']],
      [3, 'raw', []],
    ],
  )
  assert.deepEqual(notesOf(), [
    { unit: 1, card: 1, conclusion: 'confirmed' },
    { unit: 1, card: 2, conclusion: 'refuted' },
  ])
})

test('a call the hook sees twice writes one note', () => {
  const call = note('1 fixed')

  assert.equal(refusalOf(session, call), WRITTEN(1))
  assert.equal(refusalOf(session, call), '[weaver] This note is already on card 1. Go on with your task.')
  assert.equal(cardsOf(session.repo)[0]?.record.notes.length, 1)
  assert.equal(notesOf().length, 1)
})

test('a note that cannot be used is not written, and the agent reads what is wrong and the format', () => {
  const asked = (words: string, body: string | null = REPORT) => refusalOf(session, note(words, body))
  const unusable = (problem: string) => `[weaver] The note was not written: ${problem}\n\n${NoteText.FORMAT}`

  assert.equal(asked('confirmed'), unusable('The note names no card: the number of the card comes first.'))
  assert.equal(asked('1 confirmed', null), unusable('The note says nothing: say what you did, and what it showed.'))
  assert.equal(asked('7 confirmed'), unusable('No card has the number 7.'))

  refusalOf(session, bashCall(flagCommand([A_FILE], FLAG_BODY.replace('refresh()', 'renew()'))))
  withRegistry(session.repo, (registry) => registry.merge(2, 1, 'the same thing'))

  assert.equal(asked('2 confirmed'), unusable('Card #2 was merged into #1: write on that one.'))
  assert.deepEqual([cardsOf(session.repo)[0]?.record.notes.length, notesOf()], [0, []])
})
