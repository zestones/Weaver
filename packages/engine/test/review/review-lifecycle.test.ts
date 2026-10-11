import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterAll, beforeEach, test } from 'vitest'
import { CheckOutcome } from '../../src/checks/results/check-outcome.ts'
import { ReviewLedger } from '../../src/review/ledger/review-ledger.ts'
import { ReviewOutcome } from '../../src/review/results/review-outcome.ts'
import { ReviewStore } from '../../src/review/results/review-store.ts'
import { ReviewRounds } from '../../src/review/rounds/review-rounds.ts'
import type { Reviewer } from '../../src/review/running/reviewer.ts'
import { Session } from '../../src/unit-of-work/session/session.ts'
import { SAMPLE_REPO, makeRepo } from '../fixtures/repo.ts'
import {
  A_FILE,
  agentWrites,
  declaration,
  eventsOf,
  finishThrough,
  finishWith,
  PASSING,
  prompt,
  stubChecks,
  stubReviewer,
  unitFiles,
} from '../fixtures/session.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-lifecycle-'))
const BY = { runtime: 'codex', reason: 'the runtime the project names' }
// Above what a process may be numbered on this system.
const DEAD_PROCESS = 2 ** 22 + 7
const FINDING = {
  rule: 'N1',
  file: A_FILE,
  line: 1,
  message: 'two levels of abstraction in one function',
  quote: null,
  suggestion: null,
  evidence: null,
}
const found = new ReviewOutcome({ ...BY, findings: [FINDING], seconds: 42 })
const clean = new ReviewOutcome({ ...BY, seconds: 30 })
const broken = new ReviewOutcome({ ...BY, seconds: 900, failure: 'no answer after 900 s' })
const reviewed = (review: Record<string, unknown> = {}) =>
  declaration({
    review: { runtime: 'codex', ...review },
    rules: {
      L1: { level: 'gate', statement: 'The code passes the linter.', check: 'lint' },
      N1: { level: 'llm', statement: 'One level of abstraction per function.', scope: ['src/**'] },
    },
  })
// A project whose work is finished by a message with headings: a reply without them ends nothing.
const finishing = () =>
  declaration({
    finish: { headings: ['Request', 'To validate'] },
    review: { runtime: 'codex' },
    rules: {
      L1: { level: 'gate', statement: 'The code passes the linter.', check: 'lint' },
      N1: { level: 'llm', statement: 'One level of abstraction per function.', scope: ['src/**'] },
    },
  })
let session: Session
let counter = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  session = new Session(makeRepo(join(scratch, `repo-${String(counter)}`), SAMPLE_REPO), 's', 'claude')
  prompt(session, 'change it')
  agentWrites(session, { [A_FILE]: 'export const a = 2\n' })
})

const reportOf = (text: string): string => readFileSync(/Report: (\S+)/.exec(text)?.[1] ?? '', 'utf8')
const saying = (answers: string): string => `## Request\n\nDone.\n\n${answers}\n\n## To validate\n\nNothing.\n`
const finish = (reviewer: Reviewer, project = reviewed(), message?: string) =>
  finishWith(session, stubChecks([PASSING]), project, message, reviewer)
const standings = () => eventsOf(session, 'review').map((event) => event.standing)

test('a review that runs longer than the end of a turn waits for goes on by itself, and the next end of turn gives its findings', async () => {
  const slow: Reviewer = { review: () => sleep(1400).then(() => found) }
  const project = reviewed({ waitSeconds: 1 })
  const left = await finish(slow, project)

  assert.equal(left.decision, undefined, 'the agent is not kept waiting')
  assert.match(
    left.systemMessage ?? '',
    /The review by codex is still running: the unit of work stays open, and its findings come with the next end of turn\./,
  )
  assert.match(reportOf(left.systemMessage ?? ''), /## Review\n\n- by codex \(the runtime the project names\), still running after 1 s/)
  assert.deepEqual(unitFiles(session), [A_FILE])

  await sleep(600)

  const delivered = await finish(slow, project)

  assert.equal(delivered.decision, 'block')
  assert.match(delivered.reason ?? '', /the reviewer \(codex\) found 1 point\(s\)/)
  assert.deepEqual(standings(), ['running', 'sent-back'])
  assert.equal((await finish(slow, project, saying('F1 not fixed: clearer as one function'))).decision, undefined)
  assert.deepEqual(unitFiles(session), [])
})

test('a review whose process died is a review that failed, never one that found nothing', async () => {
  const neverStarted = new ReviewRounds(
    {
      start: (_repo, dir, content) => {
        const store = new ReviewStore(dir)
        const asked = store.find(content)

        if (asked !== null) store.keep(content, { ...asked, worker: DEAD_PROCESS })
      },
    },
    2,
  )
  const output = await finishThrough(session, stubChecks([PASSING]), neverStarted, reviewed())

  assert.equal(output.decision, undefined)
  assert.match(
    reportOf(output.systemMessage ?? ''),
    /- weaver:review the review by codex did not give its findings: the review stopped without an answer/,
  )
  assert.deepEqual(standings(), ['failed'])
})

test('the owner has a review that failed tried again with #review, whatever the agent then replies, if the work it covered is still there', async () => {
  const reviewer = stubReviewer([broken, found])

  assert.match((await finish(reviewer)).systemMessage ?? '', /write #review in a request to have it tried again/)
  assert.deepEqual(unitFiles(session), [], 'a review that fails holds nobody')

  prompt(session, 'the limit is lifted #review')

  const again = await finishWith(session, stubChecks([PASSING]), finishing(), 'I looked again and it reads fine to me.', reviewer)

  assert.equal(again.decision, 'block')
  assert.match(again.reason ?? '', /\nF1 N1 src\/a\.ts:1: two levels of abstraction in one function\n/)
  assert.equal(reviewer.requests.length, 2)
  assert.equal(reviewer.requests[1]?.prompt(null), reviewer.requests[0]?.prompt(null), 'the same request')

  const answered = await finishWith(session, stubChecks([PASSING]), finishing(), 'F1 not fixed: clearer as one function', reviewer)

  assert.equal(answered.decision, undefined)
  assert.match(
    answered.systemMessage ?? '',
    /No file changed in this turn\. Reviewed by codex: 1 finding\(s\), 0 answered fixed\. 1 item\(s\) to validate\./,
  )
  assert.deepEqual(standings(), ['failed', 'sent-back'])
})

test('a failed review is not tried again on work that has changed since, and #review alone asks for nothing', async () => {
  const reviewer = stubReviewer([broken, found])

  await finish(reviewer)
  agentWrites(session, { [A_FILE]: 'export const a = 9\n' })
  await finish(reviewer, declaration())
  prompt(session, 'now #review')

  const stale = await finish(reviewer)

  assert.match(stale.systemMessage ?? '', /No review: the work the failed review covered has changed since\./)
  assert.equal(reviewer.requests.length, 1)

  prompt(session, 'and again #review')
  assert.deepEqual(await finish(reviewer), {}, 'nothing failed any more')
})

test('what a review leaves for the owner is kept across sessions until the owner closes it, and a later reviewer is told', async () => {
  const careful = new ReviewOutcome({
    ...BY,
    findings: [FINDING],
    suspicions: [{ file: A_FILE, note: 'may be read before it is set' }],
    seconds: 5,
  })
  const reviewer = stubReviewer([careful, clean])
  const ledger = new ReviewLedger(session.repo)

  await finish(reviewer)
  assert.deepEqual(ledger.waiting(), [], 'nothing waits for the owner while the author has not answered')
  await finish(reviewer, reviewed(), saying('F1 not fixed: clearer as one function'))

  const [finding, suspicion] = ledger.waiting()

  assert.match(finding?.id ?? '', /^\w{7}\/F1$/)
  assert.deepEqual(
    [finding?.rule, finding?.file, finding?.line, finding?.standing, finding?.session],
    ['N1', A_FILE, 1, 'not fixed by the agent: clearer as one function', 's'],
  )
  assert.deepEqual([suspicion?.id.slice(-3), suspicion?.message], ['/S1', 'may be read before it is set'])

  assert.equal(ledger.close('nowhere/F9', 'fixed', null), 'no point is named nowhere/F9')
  assert.equal(ledger.close(finding?.id ?? '', 'wontfix', 'one function reads better'), null)
  assert.match(ledger.close(finding?.id ?? '', 'fixed', null) ?? '', /is already closed as wontfix$/)
  assert.deepEqual(
    ledger.waiting().map((point) => point.id),
    [suspicion?.id],
  )

  const later = new Session(session.repo, 'another-session', 'codex')

  prompt(later, 'touch it again')
  agentWrites(later, { [A_FILE]: 'export const a = 3\n' })
  await finishWith(later, stubChecks([PASSING]), reviewed(), undefined, reviewer)

  const asked = reviewer.requests[1]?.prompt(null) ?? ''

  assert.match(
    asked,
    /## What earlier reviews left about these files\n\n[^\n]*\n\n- N1 src\/a\.ts:1: two levels of abstraction in one function \(not fixed by the agent: clearer as one function; closed by the owner as wontfix\)\n- weaver:suspicion src\/a\.ts: may be read before it is set \(suspected by the reviewer, not verified\)/,
  )
})

test('the places a program of the project lists under a rule of level llm reach its reviewer', async () => {
  const reviewer = stubReviewer([clean])
  const listing = new CheckOutcome({
    id: 'comments',
    rules: ['N1'],
    status: 'pass',
    blocking: false,
    ms: 3,
    output: '',
    candidates: [{ rule: 'N1', file: A_FILE, line: 1, message: 'new function: a' }],
  })

  await finishWith(session, stubChecks([PASSING, listing]), reviewed(), undefined, reviewer)

  assert.match(reviewer.requests[0]?.prompt(null) ?? '', /## Places to judge\n\n[^\n]*\n\n- N1 src\/a\.ts:1: new function: a/)
})
