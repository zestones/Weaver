import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test, vi } from 'vitest'
import { Repository } from '../../src/lib/git/repository.ts'
import { ReviewOutcome } from '../../src/review/results/review-outcome.ts'
import { ReviewStore } from '../../src/review/results/review-store.ts'
import { ReviewRounds } from '../../src/review/rounds/review-rounds.ts'
import { UnitReview } from '../../src/review/rounds/unit-review.ts'
import { Journal } from '../../src/unit-of-work/journal/journal.ts'
import { Session } from '../../src/unit-of-work/session/session.ts'
import { UnitDiff } from '../../src/unit-of-work/diff/unit-diff.ts'
import { declaration } from '../fixtures/session.ts'
import { UnitOfWork } from '../../src/unit-of-work/unit/unit-of-work.ts'

const dir = mkdtempSync(join(tmpdir(), 'weaver-answer-journal-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('submissions are journaled before acceptance, survive retries, and remain separate across review attempts', () => {
  const repo = new Repository(dir, join(dir, '.git'), join(dir, '.git'))
  vi.spyOn(repo, 'hashPaths').mockReturnValue(new Map([['a.ts', 'unchanged']]))
  const session = new Session(repo, 'answers', 'claude')
  const store = new ReviewStore(session.dir)
  const unit = UnitOfWork.fresh(1).withReviewRound('content')
  const rounds = new ReviewRounds({ start: () => undefined })
  const outcome = new ReviewOutcome({
    runtime: 'codex',
    seconds: 1,
    findings: [{ file: 'a.ts', line: 1, rule: 'N1', message: 'split it', quote: null, suggestion: null, evidence: null }],
  })
  store.keep('content', {
    state: 'reviewed',
    startedAt: '2026-01-01',
    worker: null,
    head: 'tree',
    reviewed: { 'a.ts': 'unchanged' },
    answers: [],
    asked: 0,
    request: { rules: [], files: [], patch: '', skill: null, requests: [], earlier: [], candidates: [], history: [] },
    assignment: { runtime: 'codex', reason: '', model: null, effort: null, timeoutSeconds: 1, experiments: false },
    outcome,
  })
  rounds.keepAnswers(session, unit, 'F1 fixed: split the function')
  assert.deepEqual(store.find('content')?.answers, [], 'the fix cannot yet be accepted')
  rounds.keepAnswers(session, unit, 'F1 fixed: split the function')
  let record = store.find('content')
  assert.ok(record)
  store.keep('content', { ...record, journaledAnswers: 0 })
  rounds.keepAnswers(session, unit, 'F1 fixed: split the function')
  rounds.keepAnswers(session, unit, 'F1 not fixed: the owner will decide')
  record = store.find('content')
  assert.ok(record)
  store.keep('content', { ...record, startedAt: '2026-01-02', submittedAnswers: [], answers: [], journaledAnswers: 0 })
  rounds.keepAnswers(session, unit, 'F1 fixed: split the function')
  const answers = new Journal(repo).readSession(session.id).filter((event) => event.kind === 'answer')
  assert.deepEqual(
    answers.map(({ status, submission, reviewStartedAt }) => ({ status, submission, reviewStartedAt })),
    [
      { status: 'fixed', submission: 1, reviewStartedAt: '2026-01-01' },
      { status: 'not-fixed', submission: 2, reviewStartedAt: '2026-01-01' },
      { status: 'fixed', submission: 1, reviewStartedAt: '2026-01-02' },
    ],
  )
  const accepted = new UnitReview({
    standing: 'answered',
    content: 'content',
    outcome,
    round: 1,
    maxRefusals: 1,
    answers: [{ finding: 1, status: 'fixed', why: 'split the function' }],
  })
  assert.deepEqual(accepted.events(1), [], 'acceptance does not journal the submission a second time')
})

test('retrying a failed review advances its journal round without consuming another review refusal', async () => {
  const repo = new Repository(dir, join(dir, '.git'), join(dir, '.git'))
  vi.spyOn(repo, 'hashPaths').mockReturnValue(new Map())
  const session = new Session(repo, 'retried', 'claude')
  const store = new ReviewStore(session.dir)
  const outcome = new ReviewOutcome({ runtime: 'codex', seconds: 1, failure: 'no answer' })
  store.keep('failed', {
    round: 1,
    state: 'failed',
    startedAt: '2026-01-01',
    worker: null,
    head: 'tree',
    reviewed: {},
    answers: [],
    asked: 0,
    request: { rules: [], files: [], patch: '', skill: null, requests: [], earlier: [], candidates: [], history: [] },
    assignment: { runtime: 'codex', reason: '', model: null, effort: null, timeoutSeconds: 1, experiments: false },
    outcome,
  })
  session.reviewFailed('failed')
  const unit = UnitOfWork.fresh(2).withRequest({ text: '#review', at: '', source: 'prompt', answering: null })
  const rounds = new ReviewRounds({
    start: () => {
      const record = store.find('failed')
      assert.ok(record)
      store.keep('failed', { ...record, state: 'failed', outcome })
    },
  })
  const work = {
    session,
    unit,
    declaration: declaration({ review: { runtime: 'codex' } }),
    diff: new UnitDiff({ repo, dir: session.dir, base: 'base', head: 'head', files: [], excluded: [] }),
    lastMessage: null,
    candidates: [],
  }
  const retried = await rounds.next(work)
  assert.equal(store.find('failed')?.round, 2)
  assert.equal(retried?.round, 1, 'the review refusal budget is unchanged')
  assert.equal(retried?.events(2)[0]?.kind, 'review')
  assert.equal((retried?.events(2)[0] as { round: number }).round, 2)
  await rounds.next(work)
  assert.equal(store.find('failed')?.round, 3)
})
