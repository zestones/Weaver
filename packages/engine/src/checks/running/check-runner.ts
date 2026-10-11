import type { Declaration } from '../../declaration/content/declaration.ts'
import type { UnitDiff } from '../../unit-of-work/diff/unit-diff.ts'
import type { CheckOutcome } from '../results/check-outcome.ts'

export interface CheckRunner {
  // Whether a check of the project repairs before it judges, and the repairs themselves.
  repairs(declaration: Declaration): boolean
  // The repairs and the checks share one time: `deadline` is the moment it ends.
  repair(declaration: Declaration, unit: UnitDiff, deadline: number): Promise<void>

  verify(declaration: Declaration, unit: UnitDiff, deadline: number): Promise<readonly CheckOutcome[]>
}
