import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CardRegistry, FlagText } from '@weaver/memory'
import { afterAll, afterEach, beforeEach, test } from 'vitest'
import { FlagRecorder, type FlagAuthor, type FlagRequest } from '../../src/flagging/recording/flag-recorder.ts'
import type { Repository } from '../../src/lib/git/repository.ts'
import { cardsOf, FLAG_BODY } from '../fixtures/cards.ts'
import { git, makeRepo } from '../fixtures/repo.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-recorder-'))
const AUTHOR: FlagAuthor = {
  author: 'claude',
  role: 'author',
  session: 'session-1',
  subagent: null,
  unit: 3,
  requests: ['refresh the token before it expires'],
  written: () => [],
}
let repo: Repository
let registry: CardRegistry
let counter = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

afterEach(() => {
  registry.close()
})

beforeEach(() => {
  counter += 1
  repo = makeRepo(join(scratch, `repo-${String(counter)}`), { 'src/auth/token.ts': 'export function getToken() {\n  return cached\n}\n' })
  registry = new CardRegistry(repo.stateDir)
})

const request = (fields: Partial<FlagRequest> = {}): FlagRequest => ({
  callId: 'call-1',
  places: ['src/auth/token.ts:2'],
  body: FLAG_BODY,
  cwd: repo.top,
  ...fields,
})
const record = (fields: Partial<FlagRequest> = {}, by: FlagAuthor = AUTHOR) => new FlagRecorder(repo, registry).record(request(fields), by)

test('a flag is recorded as written, with who made it, where the repository stood and the lines as they were', () => {
  const answer = record()
  const [card] = cardsOf(repo)

  assert.equal(
    answer.message,
    '[weaver] Flag 1 recorded for the owner. This command is answered here and never runs: that is expected. Go on with your task.',
  )
  assert.deepEqual([answer.card?.number, answer.known, answer.problems], [1, false, []])
  assert.deepEqual([card?.origin, card?.state, card?.places], ['flag', 'raw', [{ file: 'src/auth/token.ts', line: 2 }]])
  assert.equal(card?.record.flag?.text, FLAG_BODY)
  assert.deepEqual(card?.record.flag?.fields, {
    seen: 'no call of refresh() exists under src/.',
    expected: 'the token is refreshed before a request goes out.',
    found: 'I was looking for the callers of getToken for my task.',
    checked: 'grep over src/. I did not run the application.',
    did: 'left',
    didNote: null,
  })
  assert.deepEqual(
    { ...card?.record.provenance, at: null },
    {
      author: 'claude',
      role: 'author',
      session: 'session-1',
      subagent: null,
      unit: 3,
      requests: ['refresh the token before it expires'],
      commit: git(repo.top, ['rev-parse', 'HEAD']),
      at: null,
    },
  )
  assert.deepEqual(
    card?.record.flag?.context.map(({ place, excerpt, lineText, origin }) => ({ place, excerpt, lineText, origin })),
    [
      {
        place: { file: 'src/auth/token.ts', line: 2 },
        excerpt: '1  export function getToken() {\n2    return cached\n3  }',
        lineText: '  return cached',
        origin: 'before',
      },
    ],
  )
})

test('the same call seen twice records once, and so do the same words said again in the same unit of work', () => {
  record()

  const again = record()
  const reworded = record({ callId: 'call-2' })

  assert.equal(again.message, '[weaver] This flag is already recorded as 1. Go on with your task.')
  assert.deepEqual([again.card?.number, again.known], [1, true])
  assert.deepEqual([reworded.card?.number, reworded.known], [1, true])
  assert.equal(cardsOf(repo).length, 1)
})

test('two sessions that flag the same thing in one repository each get their own card', () => {
  const first = record()
  const second = record({ callId: 'call-2' }, { ...AUTHOR, author: 'codex', session: 'session-2', unit: 1 })

  assert.deepEqual([first.card?.number, second.card?.number, second.known], [1, 2, false])
  assert.deepEqual(
    cardsOf(repo).map((card) => [card.record.provenance.author, card.record.provenance.session]),
    [
      ['claude', 'session-1'],
      ['codex', 'session-2'],
    ],
  )
})

test('a flag that misses a field is refused with what is missing and the format, and records nothing', () => {
  const answer = record({ body: 'Seen: no call of refresh().\nFound: reading the file.\nChecked: grep.\nDid: postponed\n' })

  assert.deepEqual([answer.card, answer.known], [null, false])
  assert.equal(answer.problems.length, 2)
  assert.equal(
    answer.message,
    [
      '[weaver] The flag was not recorded: `Expected:` is missing: say what you expected instead, or that it is unknown. `Did:` starts with "postponed": start it with `left as it is`, `worked around` or `fixed in the task`, then add what you want.',
      '',
      FlagText.FORMAT,
    ].join('\n'),
  )
  assert.deepEqual(cardsOf(repo), [])
})

test('a flag without a body is told where its five fields are read from', () => {
  const answer = record({ body: '' })

  assert.equal(
    answer.message,
    `[weaver] The flag was not recorded: The flag has no body: the five fields are read from a heredoc after the command.\n\n${FlagText.FORMAT}`,
  )
  assert.deepEqual(answer.problems, ['The flag has no body: the five fields are read from a heredoc after the command.'])
  assert.deepEqual(cardsOf(repo), [])
})

test('a flag may name no place at all, and the owner flags without a session', () => {
  const nowhere = record({ places: [] })
  const owner = record(
    { callId: null, places: ['src/auth/token.ts:2', 'docs/missing.md'] },
    { author: 'owner', role: 'owner', session: null, subagent: null, unit: null, requests: [] },
  )

  assert.deepEqual([nowhere.card?.places, nowhere.card?.record.flag?.context], [[], []])
  assert.deepEqual(
    [owner.card?.number, owner.card?.origin, owner.known],
    [2, 'owner', false],
    'without a session, the same words are another flag',
  )
  assert.deepEqual(
    owner.card?.record.flag?.context.map(({ place, exists, origin }) => ({ place, exists, origin })),
    [
      { place: { file: 'src/auth/token.ts', line: 2 }, exists: true, origin: 'unknown' },
      { place: { file: 'docs/missing.md', line: null }, exists: false, origin: 'unknown' },
    ],
  )
})
