import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterAll, beforeEach, test } from 'vitest'
import { CheckOutcome } from '../../src/checks/results/check-outcome.ts'
import { EndOfTaskProgress } from '../../src/loop/progress/end-of-task-progress.ts'
import { ReviewDelivery } from '../../src/review/delivery/review-delivery.ts'
import { ReviewRecovery } from '../../src/review/delivery/review-recovery.ts'
import { ReviewOutcome } from '../../src/review/results/review-outcome.ts'
import { ReviewStore } from '../../src/review/results/review-store.ts'
import { ReviewRounds } from '../../src/review/rounds/review-rounds.ts'
import { ReviewRun } from '../../src/review/running/review-run.ts'
import type { Reviewer } from '../../src/review/running/reviewer.ts'
import { Session } from '../../src/unit-of-work/session/session.ts'
import { cardsOf } from '../fixtures/cards.ts'
import { SAMPLE_REPO, makeRepo, writeFiles } from '../fixtures/repo.ts'
import {
  A_FILE,
  agentWrites,
  declaration,
  eventsOf,
  FAILING,
  finishThrough,
  PASSING,
  prompt,
  stubChecks,
  stubReviewer,
} from '../fixtures/session.ts'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const scratch = mkdtempSync(join(tmpdir(), 'weaver-parallel-review-'))
const finding = { rule: 'N1', file: A_FILE, line: 1, message: 'split the function', quote: null, suggestion: null, evidence: null }
const clean = new ReviewOutcome({ runtime: 'codex', seconds: 1 })
const found = new ReviewOutcome({ runtime: 'codex', seconds: 1, findings: [finding] })
const project = (start = 'with-checks') => declaration({ review: { start, runtime: 'codex', rules: { N1: 'One purpose per function.' } } })
const reportOf = (text: string) => readFileSync(/Report: (\S+)/.exec(text)?.[1] ?? '', 'utf8')
let session: Session
let counter = 0
const workers: Promise<void>[] = []
const rounds = (reviewer: Reviewer) =>
  new ReviewRounds(
    {
      start: (repo, dir, content) => {
        workers.push(new ReviewRun(reviewer, 1).run(repo, dir, content))
      },
    },
    1,
  )

afterAll(async () => {
  await Promise.all(workers)
  rmSync(scratch, { recursive: true, force: true })
})
beforeEach(() => {
  session = new Session(makeRepo(join(scratch, String(++counter)), SAMPLE_REPO), 's', 'claude')
  prompt(session, 'change it')
  agentWrites(session, { [A_FILE]: 'export const a = 2\n' })
})

test.each([true, false])('passing checks and review overlap, review finishes first: %s', async (reviewFirst) => {
  const checked = deferred<void>()
  const entered = deferred<void>()
  const reviewed = deferred<ReviewOutcome>()
  let requested = false
  let over = false
  const reviewer: Reviewer = {
    review: () => {
      requested = true
      return reviewed.promise
    },
  }
  const checks = {
    ...stubChecks([PASSING]),
    judge: async (...args: Parameters<ReturnType<typeof stubChecks>['judge']>) => {
      args[4]?.started('lint')
      assert.equal(requested, true)
      entered.resolve()
      await checked.promise
      args[4]?.ended(PASSING)
      return [PASSING]
    },
  }
  const ending = finishThrough(session, checks, rounds(reviewer), project()).then((answer) => {
    over = true
    return answer
  })
  await entered.promise
  const progress = EndOfTaskProgress.read(session.dir)
  assert.equal(progress?.step, 'checks')
  assert.equal(progress.checks[0]?.status, 'running')
  assert.equal(progress.review?.status, 'running')
  if (reviewFirst) reviewed.resolve(clean)
  else checked.resolve()
  await sleep(20)
  assert.equal(over, false, 'both results are needed before the turn ends')
  assert.equal(cardsOf(session.repo).length, 0)
  reviewed.resolve(clean)
  checked.resolve()
  const answer = await ending
  assert.equal(answer.decision, undefined)
  assert.match(answer.systemMessage ?? '', /Reviewed by codex: no finding/)
  assert.equal(eventsOf(session, 'check')[0]?.reviewStart, 'with-checks')
  assert.equal(EndOfTaskProgress.read(session.dir)?.outcome, 'passed')
})

test.each([false, true])('blocking checks detach a review; later delivery survives a missing session: %s', async (gone) => {
  const reviewed = deferred<ReviewOutcome>()
  const reviews = rounds({ review: () => reviewed.promise })
  const answer = await finishThrough(session, stubChecks([FAILING]), reviews, project())
  assert.equal(answer.decision, 'block')
  assert.match(answer.reason ?? '', /FAIL lint/)
  assert.match(reportOf(answer.reason ?? ''), /still running/)
  assert.equal(session.unit().reviewRounds, 0)
  const content = session.unit().reviewing ?? ''
  const store = new ReviewStore(session.dir)
  assert.equal(store.waiter(content), null)
  assert.equal(EndOfTaskProgress.read(session.dir)?.review?.standing, 'running')
  if (gone) rmSync(join(session.dir, 'state.json'))
  else agentWrites(session, { [A_FILE]: 'export const a = 3\n' })
  reviewed.resolve(found)
  await Promise.all(workers)
  new ReviewRecovery(session.repo).run()
  assert.equal(cardsOf(session.repo).length, 1)
  assert.equal(cardsOf(session.repo)[0]?.record.provenance.unit, 1)
  const delivery = new ReviewDelivery(session.repo)
  assert.match(delivery.notice(session.id) ?? '', /review findings were filed as cards/)
  assert.equal(delivery.notice(session.id), null)
  if (gone) return
  assert.equal(session.unit().reviewRounds, 0)
  const later = await finishThrough(session, stubChecks([PASSING]), reviews, project())
  assert.equal(later.decision, 'block')
  assert.match(later.reason ?? '', /split the function/)
  assert.equal(session.unit().reviewRounds, 1)
  await finishThrough(session, stubChecks([PASSING]), reviews, project())
  assert.equal(session.unit().reviewRounds, 1, 'the same review spends only one refusal')
  new ReviewRecovery(session.repo).run()
  assert.equal(cardsOf(session.repo).length, 1)
})

test('a review that finishes before blocking checks stays pending without spending a review refusal', async () => {
  const reviews = rounds(stubReviewer([found]))
  const checks = stubChecks([FAILING], () => sleep(20))
  await finishThrough(session, checks, reviews, project())
  assert.equal(session.unit().reviewRounds, 0)
  assert.equal(cardsOf(session.repo).length, 1)
  const later = await finishThrough(session, stubChecks([PASSING]), reviews, project())
  assert.match(later.reason ?? '', /refusal 1 of 1/)
})

test.each(['with-checks', 'after-checks'])('candidates are delivered or explicitly left for the owner with %s', async (start) => {
  const candidate = { rule: 'N1', file: A_FILE, line: 1, message: 'new function: a' }
  const listing = new CheckOutcome({ ...PASSING, candidates: [candidate] })
  const reviewer = stubReviewer([clean])
  const answer = await finishThrough(session, stubChecks([listing]), rounds(reviewer), project(start))
  const report = reportOf(answer.systemMessage ?? '')
  assert.deepEqual(reviewer.requests[0]?.fields.candidates, start === 'with-checks' ? [] : ['N1 src/a.ts:1: new function: a'])
  if (start === 'with-checks') {
    assert.match(report, /reviewer did not see them/)
    assert.match(report, /## To validate\n\n- src\/a.ts\n {2}- N1, line 1: new function: a/)
  } else {
    assert.doesNotMatch(report, /## To validate/)
    assert.equal(eventsOf(session, 'check')[0]?.reviewStart, 'after-checks')
  }
})

test('after-checks starts only after passing checks, and starts nothing on failure', async () => {
  const reviewer = stubReviewer([clean])
  const reviews = rounds(reviewer)
  const during = () => {
    assert.equal(reviewer.requests.length, 0)
    return Promise.resolve()
  }
  await finishThrough(session, stubChecks([FAILING], during), reviews, project('after-checks'))
  assert.equal(reviewer.requests.length, 0)
  await finishThrough(session, stubChecks([PASSING], during), reviews, project('after-checks'))
  assert.equal(reviewer.requests.length, 1)
})

test('the review and checks see the same diff after repairs', async () => {
  const reviewer = stubReviewer([clean])
  const checks = {
    ...stubChecks([PASSING]),
    repairs: () => true,
    repair: () => {
      writeFiles(session.repo.top, { [A_FILE]: 'export const a = 42\n' })
      return Promise.resolve()
    },
    judge: (...args: Parameters<ReturnType<typeof stubChecks>['judge']>) => {
      assert.match(args[1].patch(), /export const a = 42/)
      assert.match(reviewer.requests[0]?.fields.patch ?? '', /export const a = 42/)
      return Promise.resolve([PASSING])
    },
  }
  await finishThrough(session, checks, rounds(reviewer), project())
})

test('a completed review waits for long checks instead of publishing its findings during the turn', async () => {
  const reviews = rounds(stubReviewer([found]))
  const checks = stubChecks([PASSING], async () => {
    await sleep(5200)
    const content = session.unit().reviewing ?? ''
    assert.equal(new ReviewStore(session.dir).find(content)?.state, 'reviewed')
    assert.equal(cardsOf(session.repo).length, 0)
    new ReviewRecovery(session.repo).run()
    assert.equal(cardsOf(session.repo).length, 0)
  })
  const answer = await finishThrough(session, checks, reviews, project())
  assert.equal(answer.decision, 'block')
  assert.match(answer.reason ?? '', /refusal 1 of 1/)
  await Promise.all(workers)
  assert.equal(cardsOf(session.repo).length, 0, 'the agent receives the finding before it becomes an owner card')
})
