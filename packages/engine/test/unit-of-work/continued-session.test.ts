import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import type { Repository } from '../../src/lib/git/repository.ts'
import { Session } from '../../src/unit-of-work/session/session.ts'
import { SAMPLE_REPO, makeRepo } from '../fixtures/repo.ts'
import { A_FILE, agentWrites, eventsOf, prompt, stateOf, unitFiles } from '../fixtures/session.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-continued-'))
const LEFT = '12fba60f-4971-4c98-8ee0-09bb1bd821c0'
const NEW = '6863887f-3f7c-4114-8210-956f5de693ff'
let repo: Repository
let transcripts: string
let counter = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  repo = makeRepo(join(scratch, `repo-${String(counter)}`), SAMPLE_REPO)
  transcripts = join(scratch, `transcripts-${String(counter)}`)
  mkdirSync(transcripts)
})

// The transcript of a session as Claude Code leaves it, its last lines given.
function transcript(id: string, ...last: readonly object[]): void {
  const lines = [{ type: 'user', sessionId: id, message: { content: 'go on' } }, ...last]

  writeFileSync(join(transcripts, `${id}.jsonl`), lines.map((line) => `${JSON.stringify(line)}\n`).join(''))
}

function leftWithWork(): Session {
  const left = new Session(repo, LEFT, 'claude')

  prompt(left, 'port the tests')
  agentWrites(left, { [A_FILE]: 'export const a = 2\n' })
  left.maintain(true)

  return left
}

test('a session the runtime goes on with under a new id takes over the unit of work and the maintenance it left', () => {
  const left = leftWithWork()

  transcript(LEFT, { type: 'continued-in', sessionId: LEFT, continuedInSessionId: NEW }, { type: 'cost-state', sessionId: LEFT })

  const session = Session.met(repo, NEW, 'claude', join(transcripts, `${NEW}.jsonl`))

  assert.deepEqual(unitFiles(session), [A_FILE])
  assert.deepEqual(
    stateOf(session)?.unit.intents.map((intent) => intent.text),
    ['port the tests'],
  )
  assert.notEqual(session.maintenance, null)
  assert.equal(existsSync(left.dir), false, 'the session left holds nothing any more')
  assert.deepEqual(
    eventsOf(session, 'continue').map(({ session: id, from }) => ({ id, from })),
    [{ id: NEW, from: LEFT }],
  )
  assert.equal(Session.met(repo, NEW, 'claude', join(transcripts, `${NEW}.jsonl`)).id, NEW, 'a session met again looks no more')
  assert.equal(eventsOf(session, 'continue').length, 1)
})

test('a new session that continues none starts with nothing, and leaves the others as they are', () => {
  const left = leftWithWork()

  transcript(LEFT, { type: 'continued-in', sessionId: LEFT, continuedInSessionId: 'another-id' })

  const session = Session.met(repo, NEW, 'claude', join(transcripts, `${NEW}.jsonl`))

  assert.deepEqual(unitFiles(session), [])
  assert.deepEqual(unitFiles(left), [A_FILE])
  assert.equal(Session.met(repo, 'codex-thread', 'codex', null).maintenance, null, 'a runtime that names no transcript continues none')
})
