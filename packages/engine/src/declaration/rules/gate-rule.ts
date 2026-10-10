import { Rule } from './rule.ts'

export class GateRule extends Rule {
  override readonly level = 'gate'
  override readonly blocks = true
  override readonly waitsForOwner = false

  override isReviewCriterion(): boolean {
    return false
  }

  protected override levelProblem(): string | null {
    return this.check === null ? `rules.${this.id} is a gate rule and names no check: a program must settle it` : null
  }
}
