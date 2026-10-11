import type { Repository } from '../../lib/git/repository.ts'
import { ReviewRun } from '../running/review-run.ts'
import type { Reviewer } from '../running/reviewer.ts'
import type { ReviewLauncher } from './review-launcher.ts'

// The review runs in the process that asked it: for a program that lives as long as its reviews, such as a test.
export class InlineLauncher implements ReviewLauncher {
  private readonly reviewer: Reviewer

  constructor(reviewer: Reviewer) {
    this.reviewer = reviewer
  }

  start(repo: Repository, sessionDir: string, content: string): void {
    // A run keeps its own failures in the store; what is left is a store that cannot be written, which the one who
    // waits for the review finds out by itself.
    new ReviewRun(this.reviewer).run(repo, sessionDir, content).catch(() => undefined)
  }
}
