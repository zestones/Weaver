import { counted } from '../../lib/text/counted.ts'
import type { Finding } from '../../declaration/rules/finding.ts'
import type { CheckRun } from '../../unit-of-work/journal/journal-event.ts'

export type CheckStatus = 'pass' | 'fail' | 'timeout' | 'skip'

export interface OutcomeFields {
  readonly id: string
  readonly rules: readonly string[]
  readonly status: CheckStatus
  readonly blocking: boolean
  readonly ms: number
  readonly output: string
  readonly reason?: string | null
  readonly failures?: readonly Finding[]
  readonly toValidate?: readonly Finding[]
  readonly candidates?: readonly Finding[]
}

const EXCERPT_LINES = 30
// A warning comes after every call that changes a file: it stays short.
const WARNING_LINES = 12

export class CheckOutcome {
  readonly id: string
  readonly rules: readonly string[]
  readonly status: CheckStatus
  readonly blocking: boolean
  readonly ms: number
  readonly output: string
  readonly reason: string | null
  readonly failures: readonly Finding[]
  readonly toValidate: readonly Finding[]
  // Places a rule of the review is about, for the reviewer to judge one by one.
  readonly candidates: readonly Finding[]

  constructor(fields: OutcomeFields) {
    this.id = fields.id
    this.rules = fields.rules
    this.status = fields.status
    this.blocking = fields.blocking
    this.ms = fields.ms
    this.output = fields.output
    this.reason = fields.reason ?? null
    this.failures = fields.failures ?? []
    this.toValidate = fields.toValidate ?? []
    this.candidates = fields.candidates ?? []
  }

  get ran(): boolean {
    return this.status !== 'skip'
  }

  // What the journal keeps of it.
  get run(): CheckRun {
    return {
      id: this.id,
      status: this.status,
      ms: this.ms,
      failures: this.failures.length,
      toValidate: this.toValidate.length,
      candidates: this.candidates.length,
    }
  }

  get failedWithoutBlocking(): boolean {
    return this.status === 'fail' && !this.blocking
  }

  // The rules a failure is known to be about: the ones its findings name, or the only rule the check stands behind.
  // A check read by its exit status does not say which of several rules it found broken: none is named then.
  get concerned(): readonly string[] {
    const named = [...new Set(this.failures.map((finding) => finding.rule))]

    if (named.length > 0) return named

    return this.rules.length === 1 ? this.rules : []
  }

  failureLines(): string[] {
    return this.failures.length > 0 ? this.failures.map((finding) => this.line(finding)) : this.excerpt()
  }

  warningLines(): string[] {
    const lines = this.failures.length > 0 ? this.failures.map((finding) => this.line(finding)) : this.output.trim().split('\n')

    return lines.length > WARNING_LINES ? [...lines.slice(0, WARNING_LINES), `… ${String(lines.length - WARNING_LINES)} more`] : lines
  }

  validationLines(): string[] {
    return this.toValidate.map((finding) => this.line(finding))
  }

  excerpt(): string[] {
    const lines = this.output.trim().split('\n')
    const shown = lines.slice(0, EXCERPT_LINES)

    return lines.length > EXCERPT_LINES ? [...shown, `… ${counted(lines.length - EXCERPT_LINES, 'more line')} in the report`] : shown
  }

  private line(finding: Finding): string {
    const place = finding.line === undefined ? finding.file : `${finding.file}:${String(finding.line)}`

    return `${finding.rule} ${place}: ${finding.message}`
  }
}
