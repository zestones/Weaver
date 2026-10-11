import type { Blob } from '../../lib/git/repository.ts'
import type { FindingAnswer } from '../answers/finding-answer.ts'
import type { ReviewRequestFields } from '../request/review-request.ts'
import type { ReviewAssignment } from '../routing/review-routing.ts'
import type { ReviewOutcomeFields } from './review-outcome.ts'

// A review as it is kept, from the moment it is asked: what was asked and of whom, what the reviewer saw, what it
// found, and what the author answered.
export interface ReviewRecord {
  readonly state: 'running' | 'reviewed' | 'failed'
  readonly request: ReviewRequestFields
  readonly assignment: ReviewAssignment
  readonly startedAt: string
  // The process that runs it, once it has started.
  readonly worker: number | null
  readonly outcome: ReviewOutcomeFields | null
  // The tree the reviewer saw, and what each file of the unit held then.
  readonly head: string
  readonly reviewed: Readonly<Record<string, Blob>>
  readonly answers: readonly FindingAnswer[]
  // How many times the author was asked again for its answers.
  readonly asked: number
}
