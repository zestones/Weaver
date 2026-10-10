import type { CommandHints } from '../../lib/shell/writes/hints.ts'
import type { Rule } from '../rules/rule.ts'
import type { DeclaredCheck } from './declared-check.ts'
import type { DeclaredGuard } from './declared-guard.ts'
import type { FinishPolicy } from './finish-policy.ts'

export interface DeclarationFields {
  readonly exclude: readonly string[]
  readonly finish: FinishPolicy
  readonly commands: CommandHints
  readonly checks: readonly DeclaredCheck[]
  readonly guards: readonly DeclaredGuard[]
  readonly rules: readonly Rule[]
}

export class Declaration {
  readonly exclude: readonly string[]
  readonly finish: FinishPolicy
  readonly commands: CommandHints
  readonly checks: readonly DeclaredCheck[]
  readonly guards: readonly DeclaredGuard[]
  readonly rules: readonly Rule[]

  constructor(fields: DeclarationFields) {
    this.exclude = fields.exclude
    this.finish = fields.finish
    this.commands = fields.commands
    this.checks = fields.checks
    this.guards = fields.guards
    this.rules = fields.rules
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
