import { matchesAny } from '../../lib/text/glob.ts'

export type RuleLevel = 'gate' | 'llm' | 'human'

export interface RuleFields {
  readonly id: string
  readonly statement: string
  readonly source: string | null
  readonly scope: readonly string[] | null
  readonly check: string | null
}

export abstract class Rule {
  readonly id: string
  readonly statement: string
  readonly source: string | null
  readonly scope: readonly string[] | null
  readonly check: string | null

  constructor(fields: RuleFields) {
    this.id = fields.id
    this.statement = fields.statement
    this.source = fields.source
    this.scope = fields.scope
    this.check = fields.check
  }

  abstract readonly level: RuleLevel
  abstract readonly blocks: boolean
  abstract readonly waitsForOwner: boolean

  abstract isReviewCriterion(paths: readonly string[]): boolean

  bindingProblem(checks: ReadonlySet<string>, guards: readonly string[]): string | null {
    if (this.check !== null && !checks.has(this.check)) return `rules.${this.id}.check names ${this.check}, which is not a check`

    return this.levelProblem(guards)
  }

  protected appliesTo(paths: readonly string[]): boolean {
    const { scope } = this

    return paths.length > 0 && (scope === null || paths.some((path) => matchesAny(scope, path)))
  }

  protected abstract levelProblem(guards: readonly string[]): string | null
}
