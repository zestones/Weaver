import type { CheckOutcome } from '../checks/results/check-outcome.ts'
import type { Declaration } from '../declaration/content/declaration.ts'

// What the checks found on the files a call just changed, as it is told to the agent with the result of that call.
export class CallWarning {
  private readonly declaration: Declaration
  private readonly outcomes: readonly CheckOutcome[]

  constructor(declaration: Declaration, outcomes: readonly CheckOutcome[]) {
    this.declaration = declaration
    this.outcomes = outcomes
  }

  get text(): string | null {
    const blocks = this.outcomes.filter((outcome) => outcome.blocking).map((outcome) => this.block(outcome))

    return blocks.length === 0 ? null : blocks.join('\n\n')
  }

  private block(outcome: CheckOutcome): string {
    return [
      `[weaver] \`${outcome.id}\` warns, right after this call. It would hold the end of the task: fix it now.`,
      ...(outcome.reason === null ? [] : [`  ${outcome.reason}`]),
      ...outcome.warningLines().map((line) => `  ${line}`),
      ...outcome.concerned.map((rule) => `  ${rule}: ${this.declaration.statementOf(rule)}`),
    ].join('\n')
  }
}
