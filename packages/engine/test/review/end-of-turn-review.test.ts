import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import { ReviewRounds } from '../../src/review/rounds/review-rounds.ts'
import { ReviewStore } from '../../src/review/results/review-store.ts'
import { ReviewOutcome } from '../../src/review/results/review-outcome.ts'
import { Session } from '../../src/unit-of-work/session/session.ts'
import { SAMPLE_REPO, makeRepo } from '../fixtures/repo.ts'
import {
  A_FILE,
  agentWrites,
  B_FILE,
  declaration,
  eventsOf,
  FAILING,
  finishWith,
  PASSING,
  prompt,
  stubChecks,
  stubReviewer,
  unitFiles,
} from '../fixtures/session.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-review-'))
const BY = { runtime: 'codex', reason: 'the runtime the project names' }
const FINDING = {
  rule: 'N1',
  file: A_FILE,
  line: 1,
  message: 'two levels of abstraction in one function',
  quote: 'export const a = 2',
  suggestion: 'split it in two',
  evidence: null,
}
const found = new ReviewOutcome({ ...BY, summary: 'One point.', findings: [FINDING], seconds: 42, costUsd: 0.0312 })
const clean = new ReviewOutcome({ ...BY, seconds: 30 })
const reviewed = (review: Record<string, unknown> = {}) =>
  declaration({
    review: {
      runtime: 'codex',
      rules: {
        N1: { statement: 'One level of abstraction per function.', scope: ['src/**'] },
        N2: { statement: 'SQL is formatted the house way.', scope: ['**/*.sql'] },
      },
      ...review,
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
const finish = (reviewer = stubReviewer([]), project = reviewed(), message?: string) =>
  finishWith(session, stubChecks([PASSING]), project, message, reviewer)
const standings = () => eventsOf(session, 'review').map((event) => event.standing)

test('once the checks pass, the reviewer is given the rules of the review that apply, what the owner asked and the change itself', async () => {
  const reviewer = stubReviewer([clean])
  const output = await finish(reviewer)
  const asked = reviewer.requests[0]?.prompt(null) ?? ''

  assert.equal(reviewer.requests.length, 1)
  assert.match(asked, /\n- N1: One level of abstraction per function\.\n/)
  assert.doesNotMatch(asked, /N2|L1/, 'neither a rule out of scope nor a rule a program settles')
  assert.match(asked, /\n- M src\/a\.ts: lines 1\n/)
  assert.match(asked, /\n {4}1 \+ export const a = 2\n/, 'each line of the diff carries its number in the new file')
  assert.match(asked, /## What the owner asked for\n\n1\. change it/)
  assert.deepEqual([reviewer.assignments[0]?.runtime, reviewer.assignments[0]?.reason], ['codex', 'the runtime the project names'])
  assert.match(output.systemMessage ?? '', /1 check passed on 1 changed file\. Reviewed by codex: no finding\./)
  assert.deepEqual(unitFiles(session), [], 'a clean review ends the unit')
  assert.deepEqual(standings(), ['clean'])
})

test('findings send the author back, and each one needs its answer: fixed with a change in its file, or not fixed with a reason', async () => {
  const reviewer = stubReviewer([found])
  const sentBack = await finish(reviewer)

  assert.equal(sentBack.decision, 'block')
  assert.match(sentBack.reason ?? '', /the reviewer \(codex\) found 1 point on this unit of work \(refusal 1 of 1\)/)
  assert.match(sentBack.reason ?? '', /a finding never holds your change by itself, but each one needs your answer\./)
  assert.match(sentBack.reason ?? '', /one line each: `F1 fixed: <what you changed>` or `F1 not fixed: <why>`/)
  assert.match(
    sentBack.reason ?? '',
    /\nF1 N1 src\/a\.ts:1: two levels of abstraction in one function\n {2}Rule: One level of abstraction per function\.\n {2}Quote: `export const a = 2`\n {2}Suggestion: split it in two\n/,
  )
  assert.deepEqual(unitFiles(session), [A_FILE])
  assert.match(
    reportOf(sentBack.reason ?? ''),
    /## Review\n\n- by codex \(the runtime the project names\) in 42 s, \$0\.0312, review round 1, 1 refusal allowed\n- One point\.\n- sent back to the agent, which answers each finding:\n {2}- F1 N1 src\/a\.ts:1:/,
  )

  const silent = await finish(reviewer)

  assert.equal(silent.decision, 'block')
  assert.match(silent.reason ?? '', /The review by codex waits for your answers:\n\n- F1 has no answer\n/)

  const untrue = await finish(reviewer, reviewed(), saying('F1 fixed: split the function in two'))

  assert.match(untrue.reason ?? '', /- F1 is answered fixed, and src\/a\.ts has not changed since the review: nothing is fixed yet/)

  agentWrites(session, { [A_FILE]: 'export const a = 3\n' })

  const settled = await finish(reviewer, reviewed(), saying('F1 fixed: split the function in two'))

  assert.equal(settled.decision, undefined)
  assert.match(settled.systemMessage ?? '', /Reviewed by codex: 1 finding, 1 answered fixed\. Report/)
  assert.match(
    reportOf(settled.systemMessage ?? ''),
    /- answered by the agent:\n {2}- F1 N1 src\/a\.ts:1: [^\n]*\n[^]*Answered fixed: split the function in two/,
  )
  assert.equal(reviewer.requests.length, 1, 'the same work is never reviewed twice')
  assert.deepEqual(unitFiles(session), [])
  assert.deepEqual(standings(), ['sent-back'])
  assert.deepEqual(
    eventsOf(session, 'answer').map(({ finding, rule, status }) => ({ finding, rule, status })),
    [{ finding: 1, rule: 'N1', status: 'fixed' }],
  )
})

test('the journal keeps who reviewed and on what: the model, the rules it was given, the rule of each finding', async () => {
  const experiment = { command: 'npm test', observed: 'the tests pass' }
  const twice = new ReviewOutcome({
    ...BY,
    findings: [FINDING, { ...FINDING, line: 2 }],
    experiments: [experiment],
    seconds: 42,
    costUsd: 0.0312,
  })

  await finish(stubReviewer([twice]), reviewed({ reviewers: { codex: { model: 'a-model' } } }))

  assert.deepEqual(
    eventsOf(session, 'review').map(({ runtime, model, rules, findings, findingRules, experiments, seconds, costUsd }) => ({
      runtime,
      model,
      rules,
      findings,
      findingRules,
      experiments,
      seconds,
      costUsd,
    })),
    [
      {
        runtime: 'codex',
        model: 'a-model',
        rules: 1,
        findings: 2,
        findingRules: ['N1', 'N1'],
        experiments: 1,
        seconds: 42,
        costUsd: 0.0312,
      },
    ],
  )
})

test('a finding the author leaves goes to the owner with its reason, and changes nothing else', async () => {
  const reviewer = stubReviewer([found])

  await finish(reviewer)

  const left = await finish(reviewer, reviewed(), saying('- F1 not fixed: the owner asked for one function here'))

  assert.equal(left.decision, undefined)
  assert.match(left.systemMessage ?? '', /Reviewed by codex: 1 finding, 0 answered fixed\. 1 item to validate\./)
  assert.match(
    reportOf(left.systemMessage ?? ''),
    /## To validate\n\n- src\/a\.ts\n {2}- \w{7}\/F1 N1, line 1: two levels of abstraction in one function \(not fixed by the agent: the owner asked for one function here\)/,
  )
  assert.equal(reviewer.requests.length, 1)
  assert.deepEqual(unitFiles(session), [])
})

test('an author that does not answer is asked twice, then let go: the owner is told no answer came', async () => {
  const reviewer = stubReviewer([found])

  assert.equal((await finish(reviewer)).decision, 'block')
  assert.equal((await finish(reviewer)).decision, 'block')
  assert.equal((await finish(reviewer)).decision, 'block')

  const letGo = await finish(reviewer)

  assert.equal(letGo.decision, undefined)
  assert.match(
    reportOf(letGo.systemMessage ?? ''),
    /- src\/a\.ts\n {2}- \w{7}\/F1 N1, line 1: [^\n]* \(the agent gave no answer that could be taken\)/,
  )
  assert.deepEqual(
    eventsOf(session, 'answer').map((event) => event.status),
    ['missing'],
  )
})

test('work that goes beyond the findings is new work, reviewed on its own, with what was found and answered before', async () => {
  const reviewer = stubReviewer([found, found, found])

  await finish(reviewer)
  agentWrites(session, { [A_FILE]: 'export const a = 3\n', [B_FILE]: 'export const b = 1\n'.repeat(30) })
  assert.equal((await finish(reviewer, reviewed(), saying('F1 fixed: split the function in two'))).decision, undefined)
  assert.equal(reviewer.requests.length, 1, 'thirty lines elsewhere are still the answer to the review')

  prompt(session, 'and now this')
  agentWrites(session, { [A_FILE]: 'export const a = 4\n' })
  assert.equal((await finish(reviewer)).decision, 'block')
  agentWrites(session, { [A_FILE]: 'export const a = 5\n', [B_FILE]: 'export const b = 2\n'.repeat(60) })

  const handed = await finish(reviewer, reviewed(), saying('F1 not fixed: it is clearer as one function'))

  assert.equal(reviewer.requests.length, 3)
  assert.match(
    reviewer.requests[2]?.prompt(null) ?? '',
    /## What an earlier review found\n\n[^\n]*\n\n- F1 N1 src\/a\.ts:1: two levels of abstraction in one function \(answered not fixed: it is clearer as one function\)/,
  )
  assert.equal(handed.decision, undefined, 'one review may send the author back, for one request')
  assert.match(handed.systemMessage ?? '', /Reviewed by codex: 1 finding left to you\. 1 item to validate\./)
  assert.match(reportOf(handed.systemMessage ?? ''), /\(found by the last review, which the agent has not seen\)/)
  assert.deepEqual(standings(), ['sent-back', 'sent-back', 'for-owner'])
  assert.deepEqual(
    eventsOf(session, 'review').map(({ round }) => round),
    [1, 1, 2],
  )
})

test('the project says how many times the review may send the author back for one request', async () => {
  const reviewer = stubReviewer([found, found])
  const project = reviewed({ maxRefusals: 2 })

  assert.match((await finish(reviewer, project)).reason ?? '', /refusal 1 of 2/)
  agentWrites(session, { [B_FILE]: 'export const b = 2\n'.repeat(60) })
  assert.match((await finish(reviewer, project, saying('F1 not fixed: it is clearer as one function'))).reason ?? '', /refusal 2 of 2/)
})

test('a review that cannot be read holds nobody: the unit ends, and the owner is told the rules were not judged', async () => {
  const broken = new ReviewOutcome({ ...BY, seconds: 900, failure: 'no answer after 900 s' })
  const output = await finish(stubReviewer([broken]))

  assert.equal(output.decision, undefined)
  assert.match(
    output.systemMessage ?? '',
    /The review by codex did not give its findings: write #review in a request to have it tried again\. 1 item to validate\./,
  )
  assert.match(reportOf(output.systemMessage ?? ''), /- weaver:review the review by codex did not give its findings: no answer after 900 s/)
  assert.match(reportOf(output.systemMessage ?? ''), /## Rules for a reviewer, which no review judged\n\n- N1:/)
  assert.deepEqual(unitFiles(session), [])
  assert.deepEqual(standings(), ['failed'])
})

test('what the reviewer suspects, ran, and reported outside the change is for the owner, never for the author', async () => {
  const careful = new ReviewOutcome({
    ...BY,
    seconds: 20,
    suspicions: [{ file: A_FILE, note: 'the value may be read before it is set' }],
    experiments: [
      { command: 'npm test', observed: '12 passed' },
      { command: "node <<'JS'\nconsole.log(1)\nJS", observed: 'printed 1' },
    ],
    dropped: ['N1 src/b.ts:3: the unit did not change this file'],
    truncated: 2,
  })
  const output = await finish(stubReviewer([careful]))
  const report = reportOf(output.systemMessage ?? '')

  assert.equal(output.decision, undefined)
  assert.match(output.systemMessage ?? '', /Reviewed by codex: no finding\. 1 suspicion for you\. 1 item to validate\./)
  assert.match(
    report,
    /- src\/a\.ts\n {2}- \w{7}\/S1 weaver:suspicion, the value may be read before it is set \(suspected by the reviewer, not verified\)/,
  )
  assert.match(report, /- what the reviewer ran:\n {2}- `npm test`: 12 passed\n {2}- `node <<'JS' \[2 more lines\]`: printed 1/)
  assert.match(
    report,
    /- reported by the reviewer and not shown to the agent:\n {2}- N1 src\/b\.ts:3: the unit did not change this file\n {2}- 2 more findings, past the limit/,
  )
})

test('the owner’s words in a request decide the review of its work: none, or by the runtime that did not write it', async () => {
  const reviewer = stubReviewer([clean, clean])

  prompt(session, 'only a typo #no-review')

  const skipped = await finish(reviewer)

  assert.equal(reviewer.requests.length, 0)
  assert.match(skipped.systemMessage ?? '', /No review: #no-review in the request\./)
  assert.match(
    reportOf(skipped.systemMessage ?? ''),
    /## Review\n\n- no review: #no-review in the request\n[^]*## Rules for a reviewer, which no review judged/,
  )
  assert.deepEqual(standings(), ['skipped'])

  prompt(session, 'the login this time #critical')
  agentWrites(session, { [A_FILE]: 'export const a = 7\n' })
  await finish(reviewer)
  assert.deepEqual([reviewer.assignments[0]?.runtime, reviewer.assignments[0]?.reason], ['codex', '#critical in the request'])

  prompt(session, 'once more')
  agentWrites(session, { [A_FILE]: 'export const a = 8\n' })
  await finish(reviewer, reviewed({ runtime: 'same' }))
  assert.deepEqual([reviewer.assignments[1]?.runtime, reviewer.assignments[1]?.reason], ['claude', 'the runtime that wrote the change'])
})

test('no review is asked when the checks fail, when no rule of the review applies, or when the project declares no review', async () => {
  const reviewer = stubReviewer([found, found, found])
  const sqlOnly = declaration({
    review: { runtime: 'codex', rules: { N2: { statement: 'SQL is formatted the house way.', scope: ['**/*.sql'] } } },
  })

  assert.equal((await finishWith(session, stubChecks([FAILING]), reviewed(), undefined, reviewer)).decision, 'block')
  assert.equal(reviewer.requests.length, 0, 'failing checks come first')

  await finish(reviewer, sqlOnly)
  assert.equal(reviewer.requests.length, 0, 'no rule for a reviewer on these paths')

  prompt(session, 'once more')
  agentWrites(session, { [A_FILE]: 'export const a = 5\n' })

  const unreviewed = await finish(reviewer, declaration())

  assert.equal(reviewer.requests.length, 0)
  assert.doesNotMatch(reportOf(unreviewed.systemMessage ?? ''), /## Review|for a reviewer/)
})

test('answers are persisted before the 40-line routing decision and survive a new review', async () => {
  const reviewer = stubReviewer([found, clean])
  await finish(reviewer)
  const content = session.unit().lastReviewed ?? ''
  agentWrites(session, { [A_FILE]: 'export const a = 3\n', [B_FILE]: 'export const b = 2\n'.repeat(60) })
  await finish(reviewer, reviewed(), saying('F1 fixed: split the function in two'))
  assert.deepEqual(new ReviewStore(session.dir).find(content)?.answers, [{ finding: 1, status: 'fixed', why: 'split the function in two' }])
  assert.equal(reviewer.requests.length, 2)
  assert.deepEqual(
    eventsOf(session, 'answer').map(({ review, submission, status }) => ({ review, submission, status })),
    [{ review: content, submission: 1, status: 'fixed' }],
  )
  assert.match(reviewer.requests[1]?.prompt(null) ?? '', /answered fixed: split the function in two/)
})

test('partial and unvalidated answers are kept even while the existing reminders still apply', async () => {
  const reviewer = stubReviewer([new ReviewOutcome({ ...BY, findings: [FINDING, { ...FINDING, line: 2 }], seconds: 1 })])
  await finish(reviewer)
  const content = session.unit().lastReviewed ?? ''
  await finish(reviewer, reviewed(), saying('F1 fixed: attempted the split'))
  const store = new ReviewStore(session.dir)
  assert.deepEqual(store.find(content)?.submittedAnswers, [{ finding: 1, status: 'fixed', why: 'attempted the split' }])
  assert.deepEqual(store.find(content)?.answers, [], 'unvalidated answers are not treated as accepted fixes')
  assert.deepEqual(
    eventsOf(session, 'answer').map(({ finding, status, why }) => ({ finding, status, why })),
    [{ finding: 1, status: 'fixed', why: 'attempted the split' }],
  )
  await finish(reviewer, reviewed(), saying('F2 not fixed: waiting for the owner choice'))
  assert.deepEqual(
    store.find(content)?.submittedAnswers?.map((answer) => answer.finding),
    [1, 2],
  )
  assert.deepEqual(
    eventsOf(session, 'answer').map(({ finding }) => finding),
    [1, 2],
  )
})

test('a later check failure cannot discard answers to an earlier review', async () => {
  const reviewer = stubReviewer([found])
  await finish(reviewer)
  const content = session.unit().lastReviewed ?? ''
  agentWrites(session, { [A_FILE]: 'export const a = 3\n' })
  await finishWith(session, stubChecks([FAILING]), reviewed(), saying('F1 fixed: split the function in two'), reviewer)
  assert.deepEqual(new ReviewStore(session.dir).find(content)?.answers, [{ finding: 1, status: 'fixed', why: 'split the function in two' }])
  assert.equal(reviewer.requests.length, 1)
  assert.equal(eventsOf(session, 'answer')[0]?.review, content)
})

test('revised answers remain in history, including a return to an earlier answer', async () => {
  const reviewer = stubReviewer([found])
  await finish(reviewer)
  const unit = session.unit()
  const rounds = new ReviewRounds({ start: () => undefined })
  const first = 'F1 not fixed: the owner asked for one function'
  const second = 'F1 not fixed: the code needs more investigation'
  rounds.keepAnswers(session, unit, first)
  rounds.keepAnswers(session, unit, second)
  rounds.keepAnswers(session, unit, first)
  rounds.keepAnswers(session, unit, first)
  const record = new ReviewStore(session.dir).find(unit.lastReviewed ?? '')
  assert.deepEqual(
    record?.submittedAnswers?.map((answer) => answer.why),
    ['the owner asked for one function', 'the code needs more investigation', 'the owner asked for one function'],
  )
  assert.equal(record?.answers[0]?.why, 'the owner asked for one function')
  assert.deepEqual(
    eventsOf(session, 'answer').map(({ submission, why }) => ({ submission, why })),
    [
      { submission: 1, why: 'the owner asked for one function' },
      { submission: 2, why: 'the code needs more investigation' },
      { submission: 3, why: 'the owner asked for one function' },
    ],
  )
})

test('a retry after saving a submission journals it once even if the last capture was interrupted', async () => {
  await finish(stubReviewer([found]))
  const unit = session.unit()
  const content = unit.lastReviewed ?? ''
  const rounds = new ReviewRounds({ start: () => undefined })
  const store = new ReviewStore(session.dir)
  const record = store.find(content)
  assert.ok(record)
  const answer = { finding: 1, status: 'not-fixed', why: 'the owner will decide' } as const
  store.keep(content, { ...record, submittedAnswers: [answer], journaledAnswers: 0 })
  rounds.keepAnswers(session, unit, 'F1 not fixed: the owner will decide')
  assert.equal(eventsOf(session, 'answer').length, 1)
  const captured = store.find(content)
  assert.ok(captured)
  store.keep(content, { ...captured, journaledAnswers: 0 })
  rounds.keepAnswers(session, unit, 'F1 not fixed: the owner will decide')
  assert.equal(eventsOf(session, 'answer').length, 1)
  assert.equal(store.find(content)?.journaledAnswers, 1)
})

test('a fresh review of the same content journals its own submissions', async () => {
  await finish(stubReviewer([found]))
  const unit = session.unit()
  const content = unit.lastReviewed ?? ''
  const rounds = new ReviewRounds({ start: () => undefined })
  const store = new ReviewStore(session.dir)
  const message = 'F1 not fixed: the owner will decide'
  rounds.keepAnswers(session, unit, message)
  const record = store.find(content)
  assert.ok(record)
  store.keep(content, { ...record, startedAt: '2099-01-01T00:00:00Z', submittedAnswers: [], answers: [], journaledAnswers: 0 })
  rounds.keepAnswers(session, unit, message)
  assert.equal(eventsOf(session, 'answer').length, 2)
  assert.deepEqual(
    eventsOf(session, 'answer').map(({ submission }) => submission),
    [1, 1],
  )
})
