import type { Repository } from '../../lib/git/repository.ts'
import type { ReviewRequest } from '../request/review-request.ts'
import type { ReviewOutcome } from '../results/review-outcome.ts'
import type { ReviewAssignment } from '../routing/review-routing.ts'

export interface Reviewer {
  // The signal stops the review: its reviewer is ended, and what it worked in is cleared.
  review(request: ReviewRequest, assignment: ReviewAssignment, repo: Repository, signal?: AbortSignal): Promise<ReviewOutcome>
}
