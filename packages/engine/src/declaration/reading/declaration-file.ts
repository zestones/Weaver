import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Declaration } from '../content/declaration.ts'
import type { DeclaredCheck } from '../content/declared-check.ts'
import { FinishPolicy } from '../content/finish-policy.ts'
import { GateRule } from '../rules/gate-rule.ts'
import { HumanRule } from '../rules/human-rule.ts'
import { LlmRule } from '../rules/llm-rule.ts'
import type { Rule, RuleFields, RuleLevel } from '../rules/rule.ts'
import { DeclarationError } from './declaration-error.ts'
import { FieldReader } from './field-reader.ts'

const DEFAULT_TIMEOUT_SECONDS = 10 * 60

export class DeclarationFile {
  static readonly NAME = 'weaver.json'

  readonly path: string
  private readonly levels: Readonly<Record<RuleLevel, new (fields: RuleFields) => Rule>> = {
    gate: GateRule,
    llm: LlmRule,
    human: HumanRule,
  }

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
    const reader = new FieldReader()
    const parsed = this.json(text)
    const raw = reader.record(parsed, 'the declaration', ['$schema', 'version', 'scope', 'finish', 'commands', 'checks', 'rules'])
    const scope = reader.record(raw.scope, 'scope', ['exclude'])
    const commands = reader.record(raw.commands, 'commands', ['generators', 'readers'])
    const checks = reader.entries(raw.checks, 'checks').map(([id, value]) => this.check(reader, id, value))
    const rules = reader.entries(raw.rules, 'rules').map(([id, value]) => this.rule(reader, id, value))

    if (!reader.isRecord(parsed)) throw new DeclarationError(this.path, reader.problems)
    if (raw.version !== 1) reader.problems.push('version must be 1')

    const declaration = new Declaration({
      exclude: reader.strings(scope.exclude, 'scope.exclude') ?? [],
      finish: this.finish(reader, raw.finish),
      commands: {
        generators: reader.strings(commands.generators, 'commands.generators') ?? [],
        readers: reader.strings(commands.readers, 'commands.readers') ?? [],
      },
      checks,
      rules,
    })
    const problems = [...reader.problems, ...this.bindingProblems(checks, rules)]

    if (problems.length > 0) throw new DeclarationError(this.path, problems)

    return declaration
  }

  private json(text: string): unknown {
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new DeclarationError(this.path, [error instanceof Error ? error.message : String(error)])
    }
  }

  private check(reader: FieldReader, id: string, value: unknown): DeclaredCheck {
    const at = `checks.${id}`
    const raw = reader.record(value, at, ['run', 'cwd', 'when', 'reads', 'timeoutSeconds', 'after'])
    const run = reader.strings(raw.run, `${at}.run`)
    const reads = raw.reads ?? 'exit'

    if (run === null || run.length === 0) reader.problems.push(`${at}.run must name a command`)
    if (reads !== 'exit' && reads !== 'findings') reader.problems.push(`${at}.reads must be "exit" or "findings"`)

    return {
      id,
      run: run ?? [],
      cwd: reader.text(raw.cwd, `${at}.cwd`) ?? '.',
      when: reader.strings(raw.when, `${at}.when`),
      reads: reads === 'findings' ? 'findings' : 'exit',
      timeoutSeconds: reader.positive(raw.timeoutSeconds, `${at}.timeoutSeconds`, DEFAULT_TIMEOUT_SECONDS),
      after: reader.text(raw.after, `${at}.after`),
    }
  }

  private rule(reader: FieldReader, id: string, value: unknown): Rule {
    const at = `rules.${id}`
    const raw = reader.record(value, at, ['level', 'statement', 'source', 'scope', 'check'])
    const level = (Object.keys(this.levels) as RuleLevel[]).find((known) => known === raw.level)
    const statement = reader.text(raw.statement, `${at}.statement`)

    if (level === undefined) reader.problems.push(`${at}.level must be one of ${Object.keys(this.levels).join(', ')}`)
    if (statement === null && raw.statement === undefined) reader.problems.push(`${at}.statement is missing`)

    // A rule whose level cannot be read is still built, so that the rest of what is wrong with it is reported too.
    return new this.levels[level ?? 'human']({
      id,
      statement: statement ?? '',
      source: reader.text(raw.source, `${at}.source`),
      scope: reader.strings(raw.scope, `${at}.scope`),
      check: reader.text(raw.check, `${at}.check`),
    })
  }

  private finish(reader: FieldReader, value: unknown): FinishPolicy {
    const raw = reader.record(value, 'finish', ['headings', 'maxRounds', 'deadlineSeconds', 'concurrency'])
    const { maxRounds, deadlineSeconds, concurrency } = FinishPolicy.DEFAULTS

    return new FinishPolicy({
      headings: reader.strings(raw.headings, 'finish.headings'),
      maxRounds: reader.positive(raw.maxRounds, 'finish.maxRounds', maxRounds),
      deadlineSeconds: reader.positive(raw.deadlineSeconds, 'finish.deadlineSeconds', deadlineSeconds),
      concurrency: reader.positive(raw.concurrency, 'finish.concurrency', concurrency),
    })
  }

  private bindingProblems(checks: readonly DeclaredCheck[], rules: readonly Rule[]): string[] {
    const known = new Set(checks.map((check) => check.id))
    const enforced = new Set(rules.flatMap((rule) => rule.check ?? []))

    return [
      ...rules.flatMap((rule) => rule.bindingProblem(known) ?? []),
      ...checks.flatMap((check) => {
        if (!enforced.has(check.id)) return [`checks.${check.id} enforces no rule`]
        if (check.after !== null && !known.has(check.after)) return [`checks.${check.id}.after names ${check.after}, which is not a check`]

        return []
      }),
    ]
  }
}
