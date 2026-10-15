import { isAlive } from '../../lib/process/alive.ts'
import type { Repository } from '../../lib/git/repository.ts'
import { ReviewRequest } from '../request/review-request.ts'
import { ReviewOutcome } from '../results/review-outcome.ts'
import type { ReviewRecord } from '../results/review-record.ts'
import { ReviewStore } from '../results/review-store.ts'
import type { Reviewer } from './reviewer.ts'

const WATCH_MS = 1000
const INTERRUPTED = 'the end of turn that waited for it was interrupted'

// One review from the moment it was asked to its findings, kept as it goes: whoever asked reads the store.
export class ReviewRun {
  private readonly reviewer: Reviewer
  private readonly watchMs: number

  constructor(reviewer: Reviewer, watchMs: number = WATCH_MS) {
    this.reviewer = reviewer
    this.watchMs = watchMs
  }

  async run(repo: Repository, sessionDir: string, content: string): Promise<void> {
    const store = new ReviewStore(sessionDir)
    const asked = store.find(content)

    if (asked?.state !== 'running') return

    store.keep(content, { ...asked, worker: process.pid })

    const stop = new AbortController()
    // An end of turn that is gone while it still waits was interrupted, by the owner or by its runtime: the review stops
    // with it. One that stopped waiting leaves it to go on.
    const watch = setInterval(() => {
      const waiter = store.waiter(content)

      if (waiter !== null && !isAlive(waiter)) {
        store.stopWaiting(content, waiter)
        stop.abort()
      }
    }, this.watchMs)

    try {
      const outcome = await this.outcome(repo, asked, stop.signal)
      // A reviewer that answered before it could be stopped has its answer kept.
      const interrupted = stop.signal.aborted && outcome.failure !== null

      store.keep(content, interrupted ? this.interrupted(asked, outcome) : this.ended(asked, outcome))
    } finally {
      clearInterval(watch)
    }
  }

  // Whatever goes wrong, the one who asked is told: a review that says nothing would be waited for until the end.
  private async outcome(repo: Repository, asked: ReviewRecord, signal: AbortSignal): Promise<ReviewOutcome> {
    try {
      return await this.reviewer.review(new ReviewRequest(asked.request), asked.assignment, repo, signal)
    } catch (error) {
      const { runtime, reason } = asked.assignment

      return new ReviewOutcome({
        runtime,
        reason,
        seconds: 0,
        failure: `the review broke: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  private ended(asked: ReviewRecord, outcome: ReviewOutcome): ReviewRecord {
    return { ...asked, worker: process.pid, state: outcome.failure === null ? 'reviewed' : 'failed', outcome }
  }

  private interrupted(asked: ReviewRecord, outcome: ReviewOutcome): ReviewRecord {
    const { runtime, reason } = asked.assignment
    const seconds = (Date.now() - Date.parse(asked.startedAt)) / 1000
    const stopped = new ReviewOutcome({ runtime, reason, seconds, costUsd: outcome.costUsd, failure: INTERRUPTED })

    return { ...asked, worker: process.pid, state: 'interrupted', outcome: stopped }
  }
}
