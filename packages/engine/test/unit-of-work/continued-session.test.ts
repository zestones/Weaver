import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import type { Repository } from '../../src/lib/git/repository.ts'
import { Session } from '../../src/unit-of-work/session/session.ts'
import { SAMPLE_REPO, makeRepo } from '../fixtures/repo.ts'
import {
  A_FILE,
  agentWrites,
  declaration,
  eventsOf,
  FAILING,
  finishWith,
  prompt,
  stateOf,
  stubChecks,
  unitFiles,
} from '../fixtures/session.ts'

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

test('version 9 units without resolution fields keep their files, requests and unit number', () => {
  const left = leftWithWork()
  left.failRound()
  left.reviewRound('review-content')
  left.reviewRunning('pending-review')
  left.asked(['syntax'])
  const before = stateOf(left)
  assert.ok(before)
  assert.equal(before.version, 10)
  const oldCheck = Object.fromEntries(Object.entries(before.unit.check).filter(([key]) => !['retry', 'judged', 'validation'].includes(key)))
  const legacy = { ...before, version: 9, unit: { ...before.unit, check: oldCheck } }
  writeFileSync(join(left.dir, 'state.json'), JSON.stringify(legacy))
  assert.equal(before.unit.cards.resolutionAsked, undefined)
  assert.equal(before.unit.cards.resolving, undefined)
  const reopened = new Session(repo, LEFT, 'claude')
  assert.equal(reopened.askNotes([12], [12]), true)
  const after = stateOf(reopened)
  assert.equal(after?.version, 10)
  assert.deepEqual(after?.pending, before.pending)
  assert.equal(after?.maintenance, before.maintenance)
  assert.deepEqual(after?.asked, before.asked)
  assert.deepEqual(after?.unit.check, before.unit.check)
  assert.deepEqual(after?.unit.files, before.unit.files)
  assert.deepEqual(after?.unit.intents, before.unit.intents)
  assert.equal(after?.unit.number, before.unit.number)
  assert.equal(after?.unit.cards.resolutionAsked, true)
  assert.deepEqual(after?.unit.cards.resolving, [12])
  assert.equal(reopened.askNotes([13], [13]), false)
})

test('an exhausted unit keeps its refusals and report when its session continues under a new id', async () => {
  const left = leftWithWork()
  const project = declaration({ limits: { maxRefusals: 1 } })
  const checks = stubChecks([FAILING])
  await finishWith(left, checks, project)
  transcript(LEFT, { type: 'continued-in', sessionId: LEFT, continuedInSessionId: NEW })
  const continued = Session.met(repo, NEW, 'claude', join(transcripts, `${NEW}.jsonl`))
  const answer = await finishWith(continued, checks, project)
  assert.equal(answer.decision, undefined)
  assert.equal(checks.calls.count, 1)
  const report = /Report: (\S+)/.exec(answer.systemMessage ?? '')?.[1] ?? ''
  assert.match(readFileSync(report, 'utf8'), /checks failed/)
  assert.ok(report.startsWith(continued.dir))
})
