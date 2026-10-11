export interface CheckLimitsFields {
  readonly maxRefusals: number
  readonly totalTimeoutSeconds: number
  readonly parallel: number
}

export class CheckLimits {
  readonly maxRefusals: number
  // For the repairs and the checks all together, each time the agent says it has finished.
  readonly totalTimeoutSeconds: number
  readonly parallel: number

  constructor(fields: CheckLimitsFields) {
    this.maxRefusals = fields.maxRefusals
    this.totalTimeoutSeconds = fields.totalTimeoutSeconds
    this.parallel = fields.parallel
  }

  deadlineFrom(startedAt: number): number {
    return startedAt + this.totalTimeoutSeconds * 1000
  }

  isExhaustedAfter(failures: number): boolean {
    return failures > this.maxRefusals
  }
}
