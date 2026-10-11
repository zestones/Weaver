import type { Repository } from '../../lib/git/repository.ts'
import type { ReviewRequest } from '../request/review-request.ts'
import type { ReviewOutcome } from '../results/review-outcome.ts'
import type { ReviewAssignment } from '../routing/review-routing.ts'

export interface Reviewer {
  review(request: ReviewRequest, assignment: ReviewAssignment, repo: Repository): Promise<ReviewOutcome>
}
