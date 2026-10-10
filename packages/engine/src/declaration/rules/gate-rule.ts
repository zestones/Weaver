import { Rule } from './rule.ts'

export class GateRule extends Rule {
  override readonly level = 'gate'
  override readonly blocks = true
  override readonly waitsForOwner = false

  override isReviewCriterion(): boolean {
    return false
  }

  protected override levelProblem(guards: readonly string[]): string | null {
    const enforced = this.check !== null || guards.length > 0

    return enforced ? null : `rules.${this.id} is a gate rule and nothing enforces it: it needs a check or a guard`
  }
}
