import type { Declaration } from '../../declaration/content/declaration.ts'
import type { UnitDiff } from '../../unit-of-work/diff/unit-diff.ts'
import type { CheckOutcome } from '../results/check-outcome.ts'

export interface CheckRunner {
  run(declaration: Declaration, unit: UnitDiff): Promise<readonly CheckOutcome[]>
}
