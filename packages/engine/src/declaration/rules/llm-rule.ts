import { Rule } from './rule.ts'

export class LlmRule extends Rule {
  override readonly level = 'llm'
  override readonly blocks = false
  override readonly waitsForOwner = false

  override isReviewCriterion(paths: readonly string[]): boolean {
    return this.appliesTo(paths)
  }
}
