import type { Experiment, ReviewFinding, Suspicion } from '../findings/review-finding.ts'

export interface ReviewOutcomeFields {
  readonly runtime: string
  readonly reason?: string
  readonly seconds: number
  readonly summary?: string
  readonly findings?: readonly ReviewFinding[]
  readonly suspicions?: readonly Suspicion[]
  readonly experiments?: readonly Experiment[]
  readonly dropped?: readonly string[]
  readonly truncated?: number
  readonly failure?: string | null
  readonly costUsd?: number | null
}

export class ReviewOutcome {
  readonly runtime: string
  // Why this runtime reviewed.
  readonly reason: string
  readonly seconds: number
  readonly summary: string
  readonly findings: readonly ReviewFinding[]
  readonly suspicions: readonly Suspicion[]
  readonly experiments: readonly Experiment[]
  // What the reviewer reported and the author does not read, each with why, and how many findings went past the limit.
  readonly dropped: readonly string[]
  readonly truncated: number
  // Why no review could be read; null when the reviewer gave its findings, even none.
  readonly failure: string | null
  readonly costUsd: number | null

  constructor(fields: ReviewOutcomeFields) {
    this.runtime = fields.runtime
    this.reason = fields.reason ?? ''
    this.seconds = fields.seconds
    this.summary = fields.summary ?? ''
    this.findings = fields.findings ?? []
    this.suspicions = fields.suspicions ?? []
    this.experiments = fields.experiments ?? []
    this.dropped = fields.dropped ?? []
    this.truncated = fields.truncated ?? 0
    this.failure = fields.failure ?? null
    this.costUsd = fields.costUsd ?? null
  }

  get found(): boolean {
    return this.findings.length > 0
  }

  // F1, F2...: the name the author answers a finding by.
  line(index: number): string {
    const finding = this.findings[index]

    if (finding === undefined) return ''

    const place = finding.line === undefined ? finding.file : `${finding.file}:${String(finding.line)}`

    return `F${String(index + 1)} ${finding.rule} ${place}: ${finding.message}`
  }

  lines(): string[] {
    return this.findings.map((_, index) => this.line(index))
  }
}
