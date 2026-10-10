import { foldHeading, headingsOf } from '../../lib/text/headings.ts'

export interface FinishFields {
  readonly headings: readonly string[] | null
  readonly maxRounds: number
  readonly deadlineSeconds: number
  readonly concurrency: number
}

export class FinishPolicy {
  static readonly DEFAULTS: FinishFields = { headings: null, maxRounds: 3, deadlineSeconds: 20 * 60, concurrency: 3 }

  readonly headings: readonly string[] | null
  readonly maxRounds: number
  readonly deadlineSeconds: number
  readonly concurrency: number

  constructor(fields: FinishFields) {
    this.headings = fields.headings
    this.maxRounds = fields.maxRounds
    this.deadlineSeconds = fields.deadlineSeconds
    this.concurrency = fields.concurrency
  }

  declaresFinished(message: string | null): boolean {
    if (this.headings === null) return true
    if (message === null) return false

    const found = headingsOf(message)

    return this.headings.every((heading) => found.has(foldHeading(heading)))
  }

  isExhaustedAfter(rounds: number): boolean {
    return rounds > this.maxRounds
  }
}
