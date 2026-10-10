import { Rule } from './rule.ts'

export class LlmRule extends Rule {
  override readonly level = 'llm'
  override readonly blocks = false
  override readonly waitsForOwner = false

  override isReviewCriterion(paths: readonly string[]): boolean {
    return this.appliesTo(paths)
  }

  protected override levelProblem(guards: readonly string[]): string | null {
    const enforcer = this.check === null ? guards[0] : this.check

    return enforcer === undefined ? null : `rules.${this.id} is an llm rule and ${enforcer} enforces it: a reviewer settles it`
  }
}
