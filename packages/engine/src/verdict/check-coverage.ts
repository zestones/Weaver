import type { CheckOutcome } from '../checks/results/check-outcome.ts'

export class CheckCoverage {
  private readonly afterCap: boolean
  private readonly configured: number
  private readonly outcomes: readonly CheckOutcome[]
  private readonly files: number

  constructor(configured: number, outcomes: readonly CheckOutcome[], files: number, afterCap = false) {
    this.afterCap = afterCap
    this.configured = configured
    this.outcomes = outcomes
    this.files = files
  }

  get description(): string {
    if (this.afterCap) return 'Checks not re-run after the refusal cap; left to the owner'
    if (this.files === 0) return 'No in-scope file changed; nothing was checked'
    if (this.configured === 0) return 'No checks are configured; nothing was checked'
    if (!this.outcomes.some((outcome) => outcome.ran)) return 'All checks were skipped; nothing was checked'
    if (this.outcomes.every((outcome) => !outcome.ran || outcome.keptFrom !== null)) return 'Previous check results were reused'

    return 'Checks passed'
  }

  get unchecked(): boolean {
    return !this.outcomes.some((outcome) => outcome.ran)
  }
}
