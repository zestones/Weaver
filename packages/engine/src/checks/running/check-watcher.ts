import type { CheckOutcome } from '../results/check-outcome.ts'

// Who follows the checks while they run, as someone waiting for them would: one starts, one ends.
export interface CheckWatcher {
  started(id: string): void
  ended(outcome: CheckOutcome): void
}
