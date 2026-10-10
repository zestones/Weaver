import { Rule } from './rule.ts'

export class HumanRule extends Rule {
  override readonly level = 'human'
  override readonly blocks = false
  override readonly waitsForOwner = true

  override isReviewCriterion(): boolean {
    return false
  }

  protected override levelProblem(): string | null {
    return null
  }
}
