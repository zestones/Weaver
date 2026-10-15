import type { Declaration } from '../../declaration/content/declaration.ts'
import type { CallDiff } from '../../unit-of-work/diff/call-diff.ts'
import type { UnitDiff } from '../../unit-of-work/diff/unit-diff.ts'
import type { CheckMemory } from '../results/check-memory.ts'
import type { CheckOutcome } from '../results/check-outcome.ts'

export interface CheckRunner {
  // Whether a check of the project warns right after a call, and what the ones concerned found on what the call
  // changed. `deadline` is the moment their time ends: a warning still running then says nothing.
  warns(declaration: Declaration): boolean
  warn(declaration: Declaration, call: CallDiff, deadline: number): Promise<readonly CheckOutcome[]>

  // Whether a check of the project repairs before it judges, and the repairs themselves.
  repairs(declaration: Declaration): boolean
  // The repairs and the checks share one time: `deadline` is the moment it ends.
  repair(declaration: Declaration, unit: UnitDiff, deadline: number): Promise<void>

  // A check whose verdict `memory` holds for the same trees gives it again without running.
  judge(declaration: Declaration, unit: UnitDiff, deadline: number, memory?: CheckMemory): Promise<readonly CheckOutcome[]>
}
