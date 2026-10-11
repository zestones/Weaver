import { setTimeout as sleep } from 'node:timers/promises'
import type { Declaration } from '../../declaration/content/declaration.ts'
import type { ReviewPolicy } from '../../declaration/content/review-policy.ts'
import type { Finding } from '../../declaration/rules/finding.ts'
import type { UnitDiff } from '../../unit-of-work/diff/unit-diff.ts'
import type { Session } from '../../unit-of-work/session/session.ts'
import type { UnitOfWork } from '../../unit-of-work/unit/unit-of-work.ts'
import { AuthorAnswers } from '../answers/author-answers.ts'
import type { ReviewLauncher } from '../launching/review-launcher.ts'
import { ReviewLedger } from '../ledger/review-ledger.ts'
import { ReviewOutcome } from '../results/review-outcome.ts'
import type { ReviewRecord } from '../results/review-record.ts'
import { ReviewStore } from '../results/review-store.ts'
import { OwnerDirectives } from '../routing/owner-directives.ts'
import { ReviewRouting } from '../routing/review-routing.ts'
import { UnitReview } from './unit-review.ts'

export interface ReviewedWork {
  readonly session: Session
  readonly declaration: Declaration
  readonly unit: UnitOfWork
  readonly diff: UnitDiff
  readonly lastMessage: string | null
  // The places the checks listed for the rules of the review.
  readonly candidates: readonly Finding[]
}

// Answering the findings may change the files they name freely, and this many lines elsewhere. More is new work, which
// gets a review of its own.
const ANSWER_ALLOWANCE_LINES = 40
const ANSWER_REMINDERS = 2
const POLL_MS = 500
// A review whose process has not shown up after this long never started.
const START_GRACE_MS = 30_000

// Where the review of a unit stands at an end of turn: a review to ask, one that is running, or the answers to one
// that was given. The same work is never reviewed twice, so that an opinion that changes from one run to the next
// cannot loop.
export class ReviewRounds {
  private readonly launcher: ReviewLauncher
  private readonly pollMs: number

  constructor(launcher: ReviewLauncher, pollMs: number = POLL_MS) {
    this.launcher = launcher
    this.pollMs = pollMs
  }

  // Whether a turn that changed no file still has a review to follow: one that runs, one that waits for its answers,
  // or one that failed and that the owner asks for again.
  follows(session: Session, declaration: Declaration, unit: UnitOfWork): boolean {
    if (declaration.review === null) return false

    return (
      unit.reviewing !== null || unit.lastReviewed !== null || (session.failedReview !== null && new OwnerDirectives(unit.requests).review)
    )
  }

  // null when nothing is to be reviewed: no reviewer declared, or no rule for one on these paths.
  async next(work: ReviewedWork): Promise<UnitReview | null> {
    const policy = work.declaration.review
    const review = policy === null ? null : await this.stage(work, policy)

    if (review?.standing === 'sent-back') work.session.reviewRound(review.content)
    if (review?.standing === 'failed') work.session.reviewFailed(review.content)

    return review
  }

  private stage(work: ReviewedWork, policy: ReviewPolicy): Promise<UnitReview | null> | UnitReview | null {
    const { session, declaration, unit, diff } = work
    const store = new ReviewStore(session.dir)
    const directives = new OwnerDirectives(unit.requests)
    const given = unit.lastReviewed === null ? null : store.find(unit.lastReviewed)

    // A review that is no longer kept cannot be waited for: the unit is reviewed as if none had started.
    if (unit.reviewing !== null && store.find(unit.reviewing) !== null) return this.delivered(store, unit.reviewing, work, policy)
    if (given !== null && unit.lastReviewed !== null && !this.isNewWork(given, work))
      return this.answered(store, unit.lastReviewed, given, work, policy)
    if (unit.isEmpty)
      return directives.review && session.failedReview !== null ? this.retried(store, session.failedReview, work, policy) : null
    if (declaration.reviewCriteria(diff.paths).length === 0) return null

    return directives.skipsReview ? this.skipped(unit, policy, '#no-review in the request') : this.asked(store, given, work, policy)
  }

  private asked(store: ReviewStore, earlier: ReviewRecord | null, work: ReviewedWork, policy: ReviewPolicy): Promise<UnitReview> {
    const { session, declaration, unit, diff, candidates } = work
    const content = unit.content()

    store.keep(content, {
      state: 'running',
      request: {
        rules: declaration.reviewCriteria(diff.paths).map(({ id, statement, evidence }) => ({ id, statement, evidence })),
        files: diff.files,
        patch: diff.patch(),
        skill: policy.skill,
        requests: unit.requests,
        earlier: earlier === null ? [] : this.earlierLines(earlier, work),
        candidates: candidates.map(
          ({ rule, file, line, message }) => `${rule} ${line === undefined ? file : `${file}:${String(line)}`}: ${message}`,
        ),
        history: new ReviewLedger(session.repo).about(diff.paths),
      },
      assignment: new ReviewRouting(policy, new OwnerDirectives(unit.requests)).assign(session.agent, diff),
      startedAt: new Date().toISOString(),
      worker: null,
      outcome: null,
      head: diff.head,
      reviewed: Object.fromEntries(session.repo.hashPaths(Object.keys(unit.files))),
      answers: [],
      asked: 0,
    })
    this.started(session, content)

    return this.delivered(store, content, work, policy)
  }

  // The same request is asked again, of the reviewer the project names today, if the work it covers is still there.
  private retried(store: ReviewStore, content: string, work: ReviewedWork, policy: ReviewPolicy): Promise<UnitReview> | UnitReview | null {
    const { session, unit } = work
    const failed = store.find(content)

    session.reviewFailed(null)

    if (failed === null) return null
    if (this.unchangedSince(failed, session).size < Object.keys(failed.reviewed).length) {
      return this.skipped(unit, policy, 'the work the failed review covered has changed since')
    }

    const { runtime, reason } = failed.assignment
    const assignment = {
      runtime,
      reason,
      ...policy.reviewers[runtime],
      timeoutSeconds: policy.timeoutSeconds,
      experiments: policy.experiments,
    }

    store.keep(content, { ...failed, state: 'running', assignment, startedAt: new Date().toISOString(), worker: null, outcome: null })
    this.started(session, content)

    return this.delivered(store, content, work, policy)
  }

  // The unit points at its review from the moment it starts: a hook that is stopped while it waits leaves the review
  // to the next end of turn, which finds it instead of asking for another.
  private started(session: Session, content: string): void {
    session.reviewRunning(content)
    this.launcher.start(session.repo, session.dir, content)
  }

  private async delivered(store: ReviewStore, content: string, work: ReviewedWork, policy: ReviewPolicy): Promise<UnitReview> {
    const record = await this.awaited(store, content, policy.waitSeconds * 1000)
    const { runtime, reason } = record.assignment
    const round = work.unit.reviewRounds + 1
    const about = { content, round, maxRefusals: policy.maxRefusals }

    if (record.state === 'running') {
      const seconds = (Date.now() - Date.parse(record.startedAt)) / 1000

      return new UnitReview({ ...about, standing: 'running', outcome: new ReviewOutcome({ runtime, reason, seconds }) })
    }

    const outcome = new ReviewOutcome(record.outcome ?? { runtime, reason, seconds: 0, failure: 'the review left no answer' })

    if (record.state === 'failed' || outcome.failure !== null) return new UnitReview({ ...about, standing: 'failed', outcome })
    if (!outcome.found) return new UnitReview({ ...about, standing: 'clean', outcome })

    return new UnitReview({ ...about, standing: round <= policy.maxRefusals ? 'sent-back' : 'for-owner', outcome })
  }

  // The review is in the hands of another process: the end of the turn waits for it as long as the project allows,
  // and no longer than that process lives.
  private async awaited(store: ReviewStore, content: string, waitMs: number): Promise<ReviewRecord> {
    const deadline = Date.now() + waitMs

    for (;;) {
      const record = store.find(content)

      if (record === null) throw new Error('the review this unit of work was waiting for is no longer kept')
      if (record.state !== 'running') return record
      if (this.isLost(record)) return this.lost(store, content, record)
      if (Date.now() >= deadline) return record

      await sleep(this.pollMs)
    }
  }

  private lost(store: ReviewStore, content: string, record: ReviewRecord): ReviewRecord {
    const { runtime, reason } = record.assignment
    const seconds = (Date.now() - Date.parse(record.startedAt)) / 1000
    const failed: ReviewRecord = {
      ...record,
      state: 'failed',
      outcome: { runtime, reason, seconds, failure: 'the review stopped without an answer' },
    }

    store.keep(content, failed)

    return failed
  }

  private isLost(record: ReviewRecord): boolean {
    if (record.worker === null) return Date.now() - Date.parse(record.startedAt) > START_GRACE_MS

    try {
      process.kill(record.worker, 0)

      return false
    } catch {
      return true
    }
  }

  private answered(store: ReviewStore, content: string, record: ReviewRecord, work: ReviewedWork, policy: ReviewPolicy): UnitReview {
    const outcome = new ReviewOutcome(record.outcome ?? { runtime: record.assignment.runtime, seconds: 0 })
    const unchanged = this.unchangedSince(record, work.session)
    const given = new AuthorAnswers(work.lastMessage)
    const problems = given.problems(outcome.findings, unchanged)
    const about = { content, outcome, round: work.unit.reviewRounds, maxRefusals: policy.maxRefusals }

    if (problems.length > 0 && record.asked < ANSWER_REMINDERS) {
      store.keep(content, { ...record, asked: record.asked + 1 })

      return new UnitReview({ ...about, standing: 'answers-wanted', problems })
    }

    const answers = given.taken(outcome.findings, unchanged)

    store.keep(content, { ...record, answers })

    return new UnitReview({ ...about, standing: 'answered', answers })
  }

  private skipped(unit: UnitOfWork, policy: ReviewPolicy, reason: string): UnitReview {
    const outcome = new ReviewOutcome({ runtime: '', reason, seconds: 0 })

    return new UnitReview({ standing: 'skipped', content: unit.content(), outcome, round: 0, maxRefusals: policy.maxRefusals })
  }

  private isNewWork(record: ReviewRecord, { unit, diff }: ReviewedWork): boolean {
    const named = new Set((record.outcome?.findings ?? []).map((finding) => finding.file))
    const others = Object.keys(unit.files).filter((path) => !named.has(path))

    try {
      return diff.linesSince(record.head, others) > ANSWER_ALLOWANCE_LINES
    } catch {
      // What the review saw can no longer be compared with: the work is reviewed as new.
      return true
    }
  }

  private earlierLines(record: ReviewRecord, work: ReviewedWork): string[] {
    const outcome = new ReviewOutcome(record.outcome ?? { runtime: record.assignment.runtime, seconds: 0 })
    const answers = new AuthorAnswers(work.lastMessage).taken(outcome.findings, this.unchangedSince(record, work.session))

    return outcome.lines().map((line, index) => {
      const answer = answers.find((each) => each.finding === index + 1)

      return answer === undefined ? `${line} (no answer)` : `${line} (answered ${answer.status.replace('-', ' ')}: ${answer.why})`
    })
  }

  // The files that hold what the review saw in them.
  private unchangedSince(record: ReviewRecord, session: Session): Set<string> {
    const now = session.repo.hashPaths(Object.keys(record.reviewed))

    return new Set(Object.keys(record.reviewed).filter((path) => now.get(path) === record.reviewed[path]))
  }
}
