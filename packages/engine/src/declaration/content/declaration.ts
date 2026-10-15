import type { ScriptHints } from '../../lib/shell/writes/hints.ts'
import type { Rule } from '../rules/rule.ts'
import type { CheckLimits } from './check-limits.ts'
import type { DeclaredCheck } from './declared-check.ts'
import type { DeclaredGuard } from './declared-guard.ts'
import type { FinishPolicy } from './finish-policy.ts'
import type { ReviewPolicy } from './review-policy.ts'
import type { WriterPolicy } from './writer-policy.ts'

export interface DeclarationFields {
  readonly exclude: readonly string[]
  readonly finish: FinishPolicy
  readonly checkLimits: CheckLimits
  readonly review: ReviewPolicy | null
  readonly scripts: ScriptHints
  readonly checks: readonly DeclaredCheck[]
  readonly guards: readonly DeclaredGuard[]
  readonly rules: readonly Rule[]
  readonly labels: Readonly<Record<string, Readonly<Record<string, string>>>>
  readonly writer: WriterPolicy | null
  readonly issue: readonly string[] | null
}

export class Declaration {
  readonly exclude: readonly string[]
  readonly finish: FinishPolicy
  readonly checkLimits: CheckLimits
  // null when the project asks for no review.
  readonly review: ReviewPolicy | null
  readonly scripts: ScriptHints
  readonly checks: readonly DeclaredCheck[]
  readonly guards: readonly DeclaredGuard[]
  readonly rules: readonly Rule[]
  // A family of labels, then each of its values with what it means. {} when the project declares none.
  readonly labels: Readonly<Record<string, Readonly<Record<string, string>>>>
  // null when the project declares no writer: its flags stay raw.
  readonly writer: WriterPolicy | null
  // The command that files an issue; null when the project names none.
  readonly issue: readonly string[] | null

  constructor(fields: DeclarationFields) {
    this.exclude = fields.exclude
    this.finish = fields.finish
    this.checkLimits = fields.checkLimits
    this.review = fields.review
    this.scripts = fields.scripts
    this.checks = fields.checks
    this.guards = fields.guards
    this.rules = fields.rules
    this.labels = fields.labels
    this.writer = fields.writer
    this.issue = fields.issue
  }

  // The files that tell agents how Weaver wants a task ended, a change reviewed and a card written.
  get skills(): string[] {
    return [this.finish.skill, this.review?.skill ?? null, this.writer?.skill ?? null].flatMap((skill) => skill ?? [])
  }

  // The same project, with only the checks named.
  withChecks(ids: ReadonlySet<string>): Declaration {
    return new Declaration({ ...this, checks: this.checks.filter((check) => ids.has(check.id)) })
  }

  rulesOf(check: string): Rule[] {
    return this.rules.filter((rule) => rule.check === check)
  }

  statementOf(rule: string): string {
    return this.rules.find((known) => known.id === rule)?.statement ?? ''
  }

  reviewCriteria(paths: readonly string[]): Rule[] {
    return this.rules.filter((rule) => rule.isReviewCriterion(paths))
  }
}
