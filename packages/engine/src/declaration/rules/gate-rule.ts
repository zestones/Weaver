import { Rule } from './rule.ts'

export class GateRule extends Rule {
  override readonly level = 'gate'
  override readonly blocks = true
  override readonly waitsForOwner = false

  override isReviewCriterion(): boolean {
    return false
  }
}
