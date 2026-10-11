import { Rule } from './rule.ts'

export class LlmRule extends Rule {
  override readonly level = 'llm'
  override readonly blocks = false
  override readonly waitsForOwner = false

  override isReviewCriterion(paths: readonly string[]): boolean {
    return this.appliesTo(paths)
  }

  // Its check, when it has one, settles nothing: it lists the places the reviewer judges.
  protected override levelProblem(guards: readonly string[]): string | null {
    const [guard] = guards

    return guard === undefined ? null : `rules.${this.id} is an llm rule and ${guard} enforces it: a reviewer settles it`
  }
}
