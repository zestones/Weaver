import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentResult, ExecutionCatalog, ScriptedExecution } from '@weaver/agent-sdk'
import { afterAll, test } from 'vitest'
import { DeclarationFile } from '../../src/declaration/reading/declaration-file.ts'
import type { ChangedFile } from '../../src/lib/git/tree-diff.ts'
import { ReviewRequest, type ReviewRequestFields } from '../../src/review/request/review-request.ts'
import type { ReviewAssignment } from '../../src/review/routing/review-routing.ts'
import { AgentReviewer } from '../../src/review/running/agent-reviewer.ts'
import { makeRepo } from '../fixtures/repo.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-reviewer-'))
const repo = makeRepo(join(scratch, 'project'), { 'src/a.ts': 'const a = raw as User\n' })
const copies = join(scratch, 'copies')
const FILES: ChangedFile[] = [{ status: 'M', path: 'src/a.ts', oldPath: 'src/a.ts', added: [[1, 1]] }]
const { rules } = new DeclarationFile('weaver.config.json').parse(
  JSON.stringify({
    version: 1,
    rules: {
      N1: { level: 'llm', statement: 'One level of abstraction per function.' },
      N2: { level: 'llm', statement: 'No cast of external data.', source: 'docs/data.md' },
      BUG: { level: 'llm', statement: 'The change has no defect.', evidence: true },
    },
  }),
)
const request = (fields: Partial<ReviewRequestFields> = {}) =>
  new ReviewRequest({
    rules,
    files: FILES,
    patch: '+const a = raw as User',
    skill: '.agents/skills/wv-review.md',
    requests: ['read the user from the response'],
    earlier: [],
    candidates: [],
    history: [],
    ...fields,
  })
const READS: ReviewAssignment = {
  runtime: 'codex',
  reason: 'the runtime the project names',
  model: 'gpt-5.5',
  effort: 'high',
  maxTurns: 80,
  maxCostUsd: 25,
  timeoutSeconds: 120,
  experiments: false,
}
const NOTHING = { summary: 'Read it.', findings: [], suspicions: [], experiments: [] }
const SETUP = { hook: '/weaver/hook.js', copies, retryAfterMs: 5 }
const answered = (answer: unknown) => new ScriptedExecution('codex', [new AgentResult({ text: '', answer, seconds: 12, costUsd: 0.02 })])
const review = (agent: ScriptedExecution, assignment: ReviewAssignment = READS) =>
  new AgentReviewer(new ExecutionCatalog([new ScriptedExecution('claude', []), agent]), SETUP).review(request(), assignment, repo)

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

test('the reviewer is the runtime it was assigned, started where the project is, to read only, and marked as a reviewer', async () => {
  const agent = answered(NOTHING)
  const outcome = await review(agent)
  const [task] = agent.tasks

  assert.deepEqual(
    [task?.cwd, task?.access, task?.beforeTool, task?.model, task?.effort, task?.timeoutSeconds, task?.environment],
    [repo.top, 'read-only', null, 'gpt-5.5', 'high', 120, { WEAVER_REVIEWER: '1' }],
  )
  assert.deepEqual([task?.maxTurns, task?.maxCostUsd], [80, 25])
  assert.match(task?.prompt ?? '', /Do not change any file: you may only read\./)
  assert.match(JSON.stringify(task?.answerSchema), /"rule":\{"type":"string","enum":\["N1","N2","BUG"\]\}/, 'only the rules it was given')
  assert.deepEqual(
    [outcome.runtime, outcome.reason, outcome.summary, outcome.failure, outcome.seconds, outcome.costUsd],
    ['codex', 'the runtime the project names', 'Read it.', null, 12, 0.02],
  )
})

test('a reviewer that may experiment works in a copy of the project, held there by Weaver’s own hook, and the copy does not outlive it', async () => {
  const agent = answered(NOTHING)

  await review(agent, { ...READS, experiments: true })

  const [task] = agent.tasks
  const copy = task?.cwd ?? ''

  assert.match(copy, new RegExp(`^${copies}/project-[0-9a-f]{10}-1$`))
  assert.equal(task?.access, 'write')
  assert.deepEqual(task?.beforeTool, [process.execPath, '/weaver/hook.js', 'PreToolUse', '--agent=codex', `--review-copy=${copy}`])
  assert.match(task?.prompt ?? '', new RegExp(`You work in a copy of the repository as the change left it, at ${copy}\\.`))
  assert.match(task?.prompt ?? '', /Experiment rather than speculate/)
  assert.equal(existsSync(copy), false)
  assert.deepEqual(readdirSync(copies), [])
})

test('the reviewer is told the rules, the way of the project, what the owner asked, the change, and what was found before', () => {
  const first = request().prompt(null)
  const second = request({ earlier: ['F1 N2 src/a.ts:1: cast of external data (answered not fixed: the owner asked for it)'] }).prompt(null)

  assert.match(first, /- N2: No cast of external data\. \(explained in docs\/data\.md\)/)
  assert.match(first, /- BUG: The change has no defect\. A finding under this rule needs the experiment that shows it\./)
  assert.match(first, /Read \.agents\/skills\/wv-review\.md first, and follow it\./)
  assert.match(first, /## What the owner asked for\n\n1\. read the user from the response/)
  assert.match(first, /\n- M src\/a\.ts: lines 1\n\n[^\n]*\n\n```diff\n\+const a = raw as User\n```/)
  assert.match(first, /The author will answer each finding once: fixed, or not fixed with a reason\./)
  assert.doesNotMatch(first, /earlier review|Places to judge/)
  assert.match(
    second,
    /## What an earlier review found\n\n[^\n]*was decided[^\n]*\n\n- F1 N2 src\/a\.ts:1: cast of external data \(answered not fixed:/,
  )
})

test('the reviewer is given the places a program of the project listed, and what earlier reviews left about the files', () => {
  const asked = request({
    candidates: ['C1 src/a.ts:1: new comment: // casts the response'],
    history: ['N2 src/a.ts:1: cast of external data (not fixed by the agent: the owner asked for it; closed by the owner as wontfix)'],
  }).prompt(null)

  assert.match(
    asked,
    /## Places to judge\n\n[^\n]*Judge each one under its rule[^\n]*\n\n- C1 src\/a\.ts:1: new comment: \/\/ casts the response/,
  )
  assert.match(
    asked,
    /## What earlier reviews left about these files\n\n[^\n]*none of these came back[^\n]*\n\n- N2 src\/a\.ts:1: cast of external data \(not fixed/,
  )
})

test('what the reviewer found is read on the working tree of the project: findings, suspicions, experiments, and what is set aside', async () => {
  const outcome = await review(
    answered({
      summary: 'One cast.',
      findings: [
        {
          rule: 'N2',
          file: 'src/a.ts',
          line: 1,
          quote: 'const a = raw as User',
          problem: 'cast of external data',
          suggestion: 'parse it',
          evidence: null,
        },
        { rule: 'N1', file: 'src/elsewhere.ts', line: 1, quote: null, problem: 'mixed levels', suggestion: null, evidence: null },
      ],
      suspicions: [{ file: 'src/a.ts', note: 'raw may be undefined' }],
      experiments: [{ command: 'npm test', observed: '3 passed' }],
    }),
  )

  assert.deepEqual(outcome.lines(), ['F1 N2 src/a.ts:1: cast of external data'])
  assert.deepEqual(outcome.suspicions, [{ file: 'src/a.ts', note: 'raw may be undefined' }])
  assert.deepEqual(outcome.experiments, [{ command: 'npm test', observed: '3 passed' }])
  assert.deepEqual(outcome.dropped, ['N1 src/elsewhere.ts:1: the unit did not change this file'])
})

test('an answer without a list of findings, a task that failed and a runtime Weaver cannot start are failures, never findings', async () => {
  const mute = await review(answered({ verdict: 'fine' }))
  const limit = new AgentResult({ text: '', seconds: 3, failure: 'usage limit reached' })
  const failed = await review(new ScriptedExecution('codex', [limit, limit]))
  const absent = await new AgentReviewer(new ExecutionCatalog([]), SETUP).review(request(), READS, repo)

  assert.equal(mute.failure, 'the reviewer answered without a list of findings')
  assert.deepEqual([failed.failure, failed.findings, failed.seconds], ['usage limit reached', [], 3])
  assert.deepEqual([absent.failure, absent.reason], ['Weaver cannot start codex', 'the runtime the project names'])
})

test('a runtime that refuses the review is asked once more; a review out of time or out of shape is not', async () => {
  const refused = new AgentResult({ text: '', seconds: 1, failure: 'usage limit reached' })
  const late = new AgentResult({ text: '', seconds: 120, failure: 'no answer after 120 s', failureKind: 'timeout' })
  const good = new AgentResult({ text: '', answer: NOTHING, seconds: 12 })
  const recovering = new ScriptedExecution('codex', [refused, good])
  const stuck = new ScriptedExecution('codex', [refused, refused, good])
  const slow = new ScriptedExecution('codex', [late, good])

  assert.equal((await review(recovering)).failure, null)
  assert.equal(recovering.tasks.length, 2)
  assert.equal((await review(stuck)).failure, 'usage limit reached')
  assert.equal(stuck.tasks.length, 2, 'once more, not for ever')
  assert.equal((await review(slow)).failure, 'no answer after 120 s')
  assert.equal(slow.tasks.length, 1)
})

test('a change too long to show is left for the reviewer to read in the files', () => {
  const asked = request({ patch: '+x\n'.repeat(120_000) }).prompt(null)

  assert.match(asked, /The patch is too long to show here: read the changed files/)
  assert.ok(asked.length < 6000)
})
