import { matchesAny } from '../../lib/text/glob.ts'

export type RuleLevel = 'gate' | 'llm' | 'human'

export interface RuleFields {
  readonly id: string
  readonly statement: string
  readonly source: string | null
  readonly scope: readonly string[] | null
  readonly check: string | null
  readonly evidence: boolean
}

export abstract class Rule {
  readonly id: string
  readonly statement: string
  readonly source: string | null
  readonly scope: readonly string[] | null
  readonly check: string | null
  // A finding under this rule must carry the experiment that shows it.
  readonly evidence: boolean

  constructor(fields: RuleFields) {
    this.id = fields.id
    this.statement = fields.statement
    this.source = fields.source
    this.scope = fields.scope
    this.check = fields.check
    this.evidence = fields.evidence
  }

  abstract readonly level: RuleLevel
  abstract readonly blocks: boolean
  abstract readonly waitsForOwner: boolean

  abstract isReviewCriterion(paths: readonly string[]): boolean

  bindingProblem(checks: ReadonlySet<string>, guards: readonly string[]): string | null {
    if (this.check !== null && !checks.has(this.check)) return `rules.${this.id}.check names ${this.check}, which is not a check`
    if (this.evidence && this.level !== 'llm')
      return `rules.${this.id}.evidence is for a rule of level llm: only a reviewer runs experiments`

    return this.levelProblem(guards)
  }

  protected appliesTo(paths: readonly string[]): boolean {
    const { scope } = this

    return paths.length > 0 && (scope === null || paths.some((path) => matchesAny(scope, path)))
  }

  protected abstract levelProblem(guards: readonly string[]): string | null
}
