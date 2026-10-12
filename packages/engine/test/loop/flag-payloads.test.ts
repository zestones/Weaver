import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Card } from '@weaver/memory'
import { afterAll, beforeEach, test } from 'vitest'
import type { Repository } from '../../src/lib/git/repository.ts'
import { Loop } from '../../src/loop/dispatch/loop.ts'
import { Journal } from '../../src/unit-of-work/journal/journal.ts'
import { cardsOf } from '../fixtures/cards.ts'
import { declarationFiles } from '../fixtures/declaration.ts'
import { makeRepo } from '../fixtures/repo.ts'
import { stubChecks, stubWriters } from '../fixtures/session.ts'

interface CallPayload {
  readonly session_id: string
  readonly tool_use_id: string
  readonly tool_input: { readonly command: string }
}

// What Claude Code and Codex really sent to the hook for a flag, on 2026-10-11: only the folders are replaced.
const PAYLOADS = join(import.meta.dirname, '../payloads')
const scratch = mkdtempSync(join(tmpdir(), 'weaver-payloads-'))
const loop = new Loop(stubChecks([]), { start: () => undefined }, stubWriters())
let repo: Repository
let counter = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  repo = makeRepo(join(scratch, `repo-${String(counter)}`), {
    ...declarationFiles({ checks: { lint: { judge: ['true'], rules: { L1: 'The code passes the linter.' } } } }),
    'src/one.js': 'export const one = 1\n',
    'tools/parse.mjs': 'export {}\n',
  })
})

const payloadOf = (name: string): CallPayload => JSON.parse(readFileSync(join(PAYLOADS, `${name}.json`), 'utf8')) as CallPayload
const heredocOf = ({ tool_input: { command } }: CallPayload): string => command.slice(command.indexOf('\n') + 1, -'EOF2'.length)

async function flagged(name: string): Promise<{ readonly reason: string; readonly card: Card | undefined }> {
  const [runtime = ''] = name.split('-')
  const payload = payloadOf(name)
  const answer = await loop.handle('PreToolUse', ['PreToolUse', `--agent=${runtime}`], JSON.stringify({ ...payload, cwd: repo.top }))
  const output = answer.body?.hookSpecificOutput

  return {
    reason: output !== undefined && 'permissionDecisionReason' in output ? output.permissionDecisionReason : '',
    card: cardsOf(repo).find((card) => card.record.provenance.session === payload.session_id),
  }
}

test('each real call records one flag, for the runtime and the session the hook was given', async () => {
  for (const [index, name] of [
    'claude-flag-plain',
    'codex-flag-plain',
    'claude-flag-chained',
    'codex-flag-chained',
    'claude-flag-subagent',
  ].entries()) {
    const { reason, card } = await flagged(name)
    const { author, role, session, unit } = card?.record.provenance ?? {}

    assert.match(reason, new RegExp(`^\\[weaver\\] Flag ${String(index + 1)} recorded for the owner\\.`), name)
    assert.deepEqual([author, role, session, unit], [name.split('-')[0], 'author', payloadOf(name).session_id, 1], name)
    assert.equal(card?.record.flag?.text, heredocOf(payloadOf(name)), name)
  }

  assert.equal(cardsOf(repo).length, 5)
  assert.deepEqual(
    new Journal(repo)
      .read()
      .map((event) => event.kind)
      .filter((kind) => kind !== 'hook'),
    ['flag', 'flag', 'flag', 'flag', 'flag'],
  )
})

test('the body of a flag arrives whole, quotes and backticks included', async () => {
  for (const name of ['claude-flag-plain', 'codex-flag-plain']) {
    const { card } = await flagged(name)

    assert.equal(
      card?.record.flag?.text,
      [
        'Seen: the constant is named one but the file exports nothing else.',
        'Expected: a second export, since "tools/parse.mjs" reads two names.',
        "Found: I was reading src/one.js for another task; it's short.",
        'Checked: grep over src/ for `two`. I did not run anything.',
        'Did: left as it is.',
        '',
      ].join('\n'),
      name,
    )
    assert.deepEqual(card.places, [{ file: 'src/one.js', line: 1 }], name)
    assert.equal(card.record.flag.fields.checked, 'grep over src/ for `two`. I did not run anything.', name)
  }
})

test('a call made by a subagent carries the session of its parent and its own id', async () => {
  const { card } = await flagged('claude-flag-subagent')

  assert.deepEqual(
    [card?.record.provenance.session, card?.record.provenance.subagent],
    ['a5ccf2df-9152-404f-b36d-b6f6a18b8966', 'a406db5d5f6bb15fe'],
  )
  assert.deepEqual(card?.places, [{ file: 'src/one.js', line: null }])
  assert.equal((await flagged('claude-flag-plain')).card?.record.provenance.subagent, null)
})

test('a flag chained after a cd, run by a path, names its places from the top of the repository', async () => {
  for (const name of ['claude-flag-chained', 'codex-flag-chained']) {
    const { card } = await flagged(name)
    const [one, parse] = card?.record.flag?.context ?? []

    assert.deepEqual(
      card?.places,
      [
        { file: 'src/one.js', line: 1 },
        { file: 'tools/parse.mjs', line: null },
      ],
      name,
    )
    assert.deepEqual([one?.exists, one?.lineText, one?.excerpt], [true, 'export const one = 1', '1  export const one = 1'], name)
    assert.deepEqual([parse?.exists, parse?.lineText], [true, null], name)
  }
})

test('the same real call seen twice records once', async () => {
  const first = await flagged('codex-flag-plain')
  const again = await flagged('codex-flag-plain')

  assert.match(first.reason, /^\[weaver\] Flag 1 recorded for the owner\./)
  assert.equal(again.reason, '[weaver] This flag is already recorded as 1. Go on with your task.')
  assert.equal(cardsOf(repo).length, 1)
})
