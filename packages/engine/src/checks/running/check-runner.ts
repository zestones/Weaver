import type { Declaration } from '../../declaration/content/declaration.ts'
import type { UnitDiff } from '../../unit-of-work/diff/unit-diff.ts'
import type { CheckOutcome } from '../results/check-outcome.ts'

export interface CheckRunner {
  // Whether a check of the project repairs before it judges, and the repairs themselves.
  repairs(declaration: Declaration): boolean
  repair(declaration: Declaration, unit: UnitDiff): Promise<void>

  run(declaration: Declaration, unit: UnitDiff): Promise<readonly CheckOutcome[]>
}
