import type { ProcessResult } from '../../lib/process/process.ts'
import type { CheckOutcome } from '../results/check-outcome.ts'
import { Check } from './check.ts'

export class ExitCheck extends Check {
  protected override read(result: ProcessResult): CheckOutcome {
    const failed = result.code !== 0

    return this.outcome({
      status: failed ? 'fail' : 'pass',
      blocking: failed && this.rules.some((rule) => rule.blocks),
      ms: result.ms,
      output: result.output,
    })
  }
}
