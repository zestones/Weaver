import type { ScriptHints } from '../../lib/shell/writes/hints.ts'
import type { Rule } from '../rules/rule.ts'
import type { DeclaredCheck } from './declared-check.ts'
import type { DeclaredGuard } from './declared-guard.ts'
import type { FinishPolicy } from './finish-policy.ts'
import type { ReviewPolicy } from './review-policy.ts'

export interface DeclarationFields {
  readonly exclude: readonly string[]
  readonly finish: FinishPolicy
  readonly review: ReviewPolicy | null
  readonly scripts: ScriptHints
  readonly checks: readonly DeclaredCheck[]
  readonly guards: readonly DeclaredGuard[]
  readonly rules: readonly Rule[]
}

export class Declaration {
  readonly exclude: readonly string[]
  readonly finish: FinishPolicy
  // null when the project asks for no review: its rules of level llm are then only listed.
  readonly review: ReviewPolicy | null
  readonly scripts: ScriptHints
  readonly checks: readonly DeclaredCheck[]
  readonly guards: readonly DeclaredGuard[]
  readonly rules: readonly Rule[]

  constructor(fields: DeclarationFields) {
    this.exclude = fields.exclude
    this.finish = fields.finish
    this.review = fields.review
    this.scripts = fields.scripts
    this.checks = fields.checks
    this.guards = fields.guards
    this.rules = fields.rules
  }

  // The files that tell agents how Weaver wants a task ended and a change reviewed.
  get skills(): string[] {
    return [this.finish.skill, this.review?.skill ?? null].flatMap((skill) => skill ?? [])
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
