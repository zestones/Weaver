import type { Repository } from '../../lib/git/repository.ts'
import { ReviewRequest } from '../request/review-request.ts'
import { ReviewOutcome } from '../results/review-outcome.ts'
import type { ReviewRecord } from '../results/review-record.ts'
import { ReviewStore } from '../results/review-store.ts'
import type { Reviewer } from './reviewer.ts'

// One review from the moment it was asked to its findings, kept as it goes: whoever asked reads the store.
export class ReviewRun {
  private readonly reviewer: Reviewer

  constructor(reviewer: Reviewer) {
    this.reviewer = reviewer
  }

  async run(repo: Repository, sessionDir: string, content: string): Promise<void> {
    const store = new ReviewStore(sessionDir)
    const asked = store.find(content)

    if (asked?.state !== 'running') return

    store.keep(content, { ...asked, worker: process.pid })

    const outcome = await this.outcome(repo, asked)

    store.keep(content, { ...asked, worker: process.pid, state: outcome.failure === null ? 'reviewed' : 'failed', outcome })
  }

  // Whatever goes wrong, the one who asked is told: a review that says nothing would be waited for until the end.
  private async outcome(repo: Repository, asked: ReviewRecord): Promise<ReviewOutcome> {
    try {
      return await this.reviewer.review(new ReviewRequest(asked.request), asked.assignment, repo)
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
}
