import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Declaration } from '../content/declaration.ts'
import type { DeclaredCheck } from '../content/declared-check.ts'
import type { DeclaredGuard } from '../content/declared-guard.ts'
import { FinishPolicy } from '../content/finish-policy.ts'
import { GateRule } from '../rules/gate-rule.ts'
import { HumanRule } from '../rules/human-rule.ts'
import { LlmRule } from '../rules/llm-rule.ts'
import type { Rule } from '../rules/rule.ts'
import type { DeclarationDocument } from '../schema/declaration-document.ts'
import { DeclarationSchema } from '../schema/declaration-schema.ts'
import { DeclarationError } from './declaration-error.ts'

export class DeclarationFile {
  static readonly NAME = 'weaver.config.json'

  readonly path: string
  private readonly levels = { gate: GateRule, llm: LlmRule, human: HumanRule }

  constructor(path: string) {
    this.path = path
  }

  static in(top: string): DeclarationFile {
    return new DeclarationFile(join(top, DeclarationFile.NAME))
  }

  load(): Declaration | null {
    return existsSync(this.path) ? this.parse(readFileSync(this.path, 'utf8')) : null
  }

  parse(text: string): Declaration {
    const { scope, finish, scripts, ...document } = this.document(text)
    const checks = Object.entries(document.checks).map(([id, check]): DeclaredCheck => ({
      ...check,
      id,
      fix: check.fix ?? null,
      when: check.when ?? null,
      after: check.after ?? null,
    }))
    const rules = Object.entries(document.rules).map(
      ([id, rule]) =>
        new this.levels[rule.level]({
          id,
          statement: rule.statement,
          source: rule.source ?? null,
          scope: rule.scope ?? null,
          check: rule.check ?? null,
        }),
    )
    const guards = Object.entries(document.guards).map(([id, guard]): DeclaredGuard => ({ ...guard, id }))
    const problems = [...this.bindingProblems(checks, guards, rules), ...this.finishProblems(finish)]

    if (problems.length > 0) throw new DeclarationError(this.path, problems)

    return new Declaration({
      exclude: scope.exclude,
      finish: new FinishPolicy({ ...finish, headings: finish.headings ?? null, skill: finish.skill ?? null }),
      scripts,
      checks,
      guards,
      rules,
    })
  }

  private document(text: string): DeclarationDocument {
    const schema = new DeclarationSchema()
    const parsed = this.json(text)

    if (!schema.accepts(parsed)) throw new DeclarationError(this.path, schema.problems)

    return parsed
  }

  private json(text: string): unknown {
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new DeclarationError(this.path, [error instanceof Error ? error.message : String(error)])
    }
  }

  private finishProblems(finish: DeclarationDocument['finish']): string[] {
    return finish.skill !== undefined && finish.headings === undefined
      ? ['finish.skill is set without finish.headings: no final message ends a unit of work, so the skill explains nothing']
      : []
  }

  // A schema describes the shape of each entry, not what ties one entry to another.
  private bindingProblems(checks: readonly DeclaredCheck[], guards: readonly DeclaredGuard[], rules: readonly Rule[]): string[] {
    const known = new Set(checks.map((check) => check.id))
    const enforced = new Set(rules.flatMap((rule) => rule.check ?? []))
    const guardsOf = (rule: Rule): string[] => guards.filter((guard) => guard.rule === rule.id).map((guard) => guard.id)

    return [
      ...rules.flatMap((rule) => rule.bindingProblem(known, guardsOf(rule)) ?? []),
      ...guards.flatMap((guard) => {
        if (!rules.some((rule) => rule.id === guard.rule)) return [`guards.${guard.id}.rule names ${guard.rule}, which is not a rule`]
        if (guard.writes.length + guard.runs.length === 0) return [`guards.${guard.id} refuses nothing: it needs writes or runs`]

        return []
      }),
      ...checks.flatMap((check) => {
        if (!enforced.has(check.id)) return [`checks.${check.id} enforces no rule`]
        if (check.after !== null && !known.has(check.after)) return [`checks.${check.id}.after names ${check.after}, which is not a check`]

        return []
      }),
    ]
  }
}
