import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterAll, beforeEach, test } from 'vitest'
import { CheckOutcome } from '../../src/checks/results/check-outcome.ts'
import { ReviewOutcome } from '../../src/review/results/review-outcome.ts'
import { ReviewStore } from '../../src/review/results/review-store.ts'
import { ReviewRounds } from '../../src/review/rounds/review-rounds.ts'
import { ReviewRun } from '../../src/review/running/review-run.ts'
import type { Reviewer } from '../../src/review/running/reviewer.ts'
import { Session } from '../../src/unit-of-work/session/session.ts'
import { cardsOf, FLAG_BODY, flagCommand, withRegistry } from '../fixtures/cards.ts'
import { SAMPLE_REPO, git, makeRepo } from '../fixtures/repo.ts'
import {
  A_FILE,
  agentWrites,
  bashCall,
  declaration,
  eventsOf,
  finishThrough,
  finishWith,
  PASSING,
  prompt,
  refusalOf,
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
const REVIEW_RULES = { N1: { statement: 'One level of abstraction per function.', scope: ['src/**'] } }
const reviewed = (review: Record<string, unknown> = {}) =>
  declaration({
    review: { runtime: 'codex', rules: REVIEW_RULES, ...review },
  })
// A project whose work is finished by a message with headings: a reply without them ends nothing.
const finishing = () =>
  declaration({
    finish: { headings: ['Request', 'To validate'] },
    review: { runtime: 'codex', rules: REVIEW_RULES },
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
  assert.match(delivered.reason ?? '', /the reviewer \(codex\) found 1 point/)
  assert.deepEqual(standings(), ['running', 'sent-back'])
  assert.equal((await finish(slow, project, saying('F1 not fixed: clearer as one function'))).decision, undefined)
  assert.deepEqual(unitFiles(session), [])
})

test('a message the owner sends while the end of turn waits for the review takes the turn from it: the review goes on', async () => {
  const slow: Reviewer = { review: () => sleep(1200).then(() => found) }
  const project = reviewed({ waitSeconds: 60 })
  const began = Date.now()
  const ending = finish(slow, project)

  await sleep(200)
  prompt(session, 'and the tests too')

  const left = await ending

  assert.ok(Date.now() - began < 1000, `the turn ended after ${String(Date.now() - began)} ms`)
  assert.equal(left.decision, undefined)
  assert.match(left.systemMessage ?? '', /The review by codex is still running/)

  await sleep(1200)

  assert.equal((await finish(slow, project)).decision, 'block', 'its findings come with the next end of turn')
  assert.deepEqual(standings(), ['running', 'sent-back'])
})

test('an end of turn interrupted while it waits takes its review with it: the reviewer is stopped, and #review runs it again', async () => {
  let stopped = false
  const waiting: Reviewer = {
    review: (_request, _assignment, _repo, signal) =>
      new Promise((resolve) => {
        signal?.addEventListener('abort', () => {
          stopped = true
          resolve(new ReviewOutcome({ ...BY, seconds: 1, failure: 'stopped before it answered' }))
        })
      }),
  }
  // The end of turn that waits is gone at once, as one its runtime cancels; the reviewer looks for it a moment later.
  const cancelled = new ReviewRounds(
    {
      start: (repo, dir, content) => {
        setTimeout(() => {
          new ReviewStore(dir).wait(content, DEAD_PROCESS)
        }, 0)
        new ReviewRun(waiting, 50).run(repo, dir, content).catch(() => undefined)
      },
    },
    2,
  )

  await finishThrough(session, stubChecks([PASSING]), cancelled, reviewed())
  await sleep(300)

  const next = await finish(stubReviewer([found]))

  assert.equal(stopped, true)
  assert.equal(next.decision, undefined)
  assert.match(
    next.systemMessage ?? '',
    /The review by codex was stopped with the end of turn that waited for it: write #review in a request to have it run again\./,
  )
  assert.match(
    reportOf(next.systemMessage ?? ''),
    /- weaver:review the review by codex was stopped: the end of turn that waited for it was interrupted/,
  )
  assert.deepEqual(standings(), ['running', 'interrupted'])

  prompt(session, 'run it after all #review')

  assert.equal((await finish(stubReviewer([found]), reviewed(), 'Done.')).decision, 'block')
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
    /No file changed in this turn\. Reviewed by codex: 1 finding, 0 answered fixed\. 1 item to validate\./,
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

test('when a unit settles, each point its review leaves for the owner becomes a card, with what the review said of it', async () => {
  const careful = new ReviewOutcome({
    ...BY,
    findings: [{ ...FINDING, quote: 'export const a = 2', suggestion: 'split it in two', evidence: 'ran it: both levels show' }],
    suspicions: [
      { file: A_FILE, note: 'may be read before it is set' },
      { file: null, note: 'the change may slow the start' },
    ],
    seconds: 5,
  })
  const reviewer = stubReviewer([careful])

  await finish(reviewer)
  assert.deepEqual(cardsOf(session.repo), [], 'nothing waits for the owner while the author has not answered')
  await finish(reviewer, reviewed(), saying('F1 not fixed: clearer as one function'))

  const [finding, suspicion, nowhere] = cardsOf(session.repo)
  const { review, ...content } = finding?.record.review ?? { review: '' }

  assert.deepEqual([finding?.origin, finding?.state, finding?.places], ['finding', 'open', [{ file: A_FILE, line: 1 }]])
  assert.match(review, /^\w{7}\/F1$/)
  assert.deepEqual(content, {
    rule: 'N1',
    statement: 'One level of abstraction per function.',
    message: 'two levels of abstraction in one function',
    quote: 'export const a = 2',
    suggestion: 'split it in two',
    evidence: 'ran it: both levels show',
    standing: 'not fixed by the agent: clearer as one function',
  })
  assert.deepEqual(
    { ...finding?.record.provenance, at: null },
    {
      author: 'codex',
      role: 'reviewer',
      session: 's',
      subagent: null,
      unit: 1,
      requests: ['change it'],
      commit: git(session.repo.top, ['rev-parse', 'HEAD']),
      at: null,
    },
  )
  assert.deepEqual([suspicion?.origin, suspicion?.places], ['suspicion', [{ file: A_FILE, line: null }]])
  assert.deepEqual(
    { ...suspicion?.record.review, review: suspicion?.record.review?.review.slice(-3) },
    {
      review: '/S1',
      rule: null,
      statement: null,
      message: 'may be read before it is set',
      quote: null,
      suggestion: null,
      evidence: null,
      standing: 'suspected by the reviewer, not verified',
    },
  )
  assert.deepEqual([nowhere?.origin, nowhere?.places, nowhere?.record.review?.message], ['suspicion', [], 'the change may slow the start'])
})

test('a finding its author fixed leaves no card, and neither does a review that found nothing', async () => {
  const reviewer = stubReviewer([found, clean])

  await finish(reviewer)
  agentWrites(session, { [A_FILE]: 'export const a = 3\n' })
  await finish(reviewer, reviewed(), saying('F1 fixed: split the function in two'))

  prompt(session, 'once more')
  agentWrites(session, { [A_FILE]: 'export const a = 4\n' })
  await finish(reviewer)

  assert.equal(reviewer.requests.length, 2)
  assert.deepEqual(unitFiles(session), [])
  assert.deepEqual(cardsOf(session.repo), [])
})

test('the next reviewer of a file is told what its cards say, and a point that comes again is an occurrence, not a second card', async () => {
  const careful = new ReviewOutcome({
    ...BY,
    findings: [FINDING],
    suspicions: [{ file: A_FILE, note: 'may be read before it is set' }],
    seconds: 5,
  })
  const reviewer = stubReviewer([careful, found, clean])

  await finish(reviewer)
  await finish(reviewer, reviewed(), saying('F1 not fixed: clearer as one function'))

  const later = new Session(session.repo, 'another-session', 'codex')
  const finishLater = (message?: string) => finishWith(later, stubChecks([PASSING]), reviewed(), message, reviewer)

  prompt(later, 'touch it again')
  agentWrites(later, { [A_FILE]: 'export const a = 3\n' })
  await finishLater()

  assert.match(
    reviewer.requests[1]?.prompt(null) ?? '',
    /## What is already known about these files\n\n[^\n]*Check that none of these came back\.[^\n]*\n\n- #2 open {2}src\/a\.ts {2}may be read before it is set \(suspected by the reviewer, not verified\)\n- #1 open {2}src\/a\.ts:1 {2}two levels of abstraction in one function \(rule N1; not fixed by the agent: clearer as one function\)\n/,
  )

  await finishLater(saying('F1 not fixed: the owner asked for one function'))

  const [finding, suspicion, ...others] = cardsOf(session.repo)

  assert.deepEqual(others, [], 'the finding the second review reports again is the card the first one left')
  assert.deepEqual(
    finding?.record.occurrences.map(({ card, provenance, note }) => [
      card,
      provenance.session,
      provenance.author,
      note.replace(/^\w{7}/, ''),
    ]),
    [[null, 'another-session', 'codex', '/F1: two levels of abstraction in one function']],
  )
  assert.deepEqual([finding?.state, suspicion?.record.occurrences], ['open', []])

  withRegistry(session.repo, (registry) => registry.closeCard(1, 'wontfix', 'one function\nreads better'))
  prompt(later, 'and once more')
  agentWrites(later, { [A_FILE]: 'export const a = 4\n' })
  await finishLater()

  assert.match(
    reviewer.requests[2]?.prompt(null) ?? '',
    /\n- #1 closed \(wontfix\) {2}src\/a\.ts:1 {2}two levels of abstraction in one function \(rule N1; not fixed by the agent: clearer as one function; the owner's reason: one function reads better\)\n/,
  )
})

test('a reviewer is told what agents flagged in the files it reads, and nothing of the other files', async () => {
  const reviewer = stubReviewer([clean])

  refusalOf(session, bashCall(flagCommand([`${A_FILE}:1`])))
  refusalOf(session, bashCall(flagCommand(['package.json'], FLAG_BODY.replace('refresh()', 'renew()'))))
  await finish(reviewer)

  const asked = reviewer.requests[0]?.prompt(null) ?? ''

  assert.match(asked, /\n- #1 raw {2}src\/a\.ts:1 {2}no call of refresh\(\) exists under src\/\.\n/)
  assert.doesNotMatch(asked, /#2|package\.json/)
})

test('the places a program of the project lists under a rule of the review reach its reviewer', async () => {
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
