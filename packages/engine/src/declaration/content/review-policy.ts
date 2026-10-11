export type ReviewerName = 'claude' | 'codex'

export interface ReviewerSettings {
  readonly model: string | null
  readonly effort: string | null
}

export interface ReviewFields {
  readonly runtime: ReviewerName | 'same' | 'other'
  readonly reviewers: Readonly<Record<ReviewerName, ReviewerSettings>>
  readonly criticalPaths: readonly string[]
  readonly criticalLines: number | null
  readonly experiments: boolean
  readonly timeoutSeconds: number
  readonly waitSeconds: number
  readonly maxRefusals: number
  readonly skill: string | null
  readonly issue: readonly string[] | null
}

export class ReviewPolicy {
  // `same` is the runtime that wrote the change, `other` the one that did not.
  readonly runtime: ReviewerName | 'same' | 'other'
  readonly reviewers: Readonly<Record<ReviewerName, ReviewerSettings>>
  // A change that touches these paths, or more lines than this, is reviewed by the runtime that did not write it.
  readonly criticalPaths: readonly string[]
  readonly criticalLines: number | null
  // The reviewer may run commands and write, in a copy of the working tree.
  readonly experiments: boolean
  readonly timeoutSeconds: number
  // How long the end of a turn waits for a review, which may run longer by itself.
  readonly waitSeconds: number
  readonly maxRefusals: number
  readonly skill: string | null
  // The command that files an issue for a point the owner closes as one.
  readonly issue: readonly string[] | null

  constructor(fields: ReviewFields) {
    this.runtime = fields.runtime
    this.reviewers = fields.reviewers
    this.criticalPaths = fields.criticalPaths
    this.criticalLines = fields.criticalLines
    this.experiments = fields.experiments
    this.timeoutSeconds = fields.timeoutSeconds
    this.waitSeconds = fields.waitSeconds
    this.maxRefusals = fields.maxRefusals
    this.skill = fields.skill
    this.issue = fields.issue
  }
}
