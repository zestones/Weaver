import { matchesAny } from '../../lib/text/glob.ts'

export type RuleLevel = 'gate' | 'llm' | 'human'

export interface RuleFields {
  readonly id: string
  readonly statement: string
  readonly scope: readonly string[] | null
  readonly check: string | null
  readonly evidence: boolean
}

// A rule is written where it is settled: in the check that stands behind it, or in the review. Its name is what the
// agent and the owner read, so it says what the rule is about.
export abstract class Rule {
  readonly id: string
  readonly statement: string
  readonly scope: readonly string[] | null
  // The check that stands behind the rule, or that lists the places a reviewer judges under it.
  readonly check: string | null
  // A finding under this rule must carry the experiment that shows it.
  readonly evidence: boolean

  constructor(fields: RuleFields) {
    this.id = fields.id
    this.statement = fields.statement
    this.scope = fields.scope
    this.check = fields.check
    this.evidence = fields.evidence
  }

  abstract readonly level: RuleLevel
  abstract readonly blocks: boolean
  abstract readonly waitsForOwner: boolean

  abstract isReviewCriterion(paths: readonly string[]): boolean

  protected appliesTo(paths: readonly string[]): boolean {
    const { scope } = this

    return paths.length > 0 && (scope === null || paths.some((path) => matchesAny(scope, path)))
  }
}
