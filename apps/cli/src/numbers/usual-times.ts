import type { CheckRun, JournalEvent } from '@weaver/engine'
import { Distribution } from './distribution.ts'

// How long the parts of an end of task usually take in this project: the median of what the journal kept of them. A
// part never measured has no usual time.
export class UsualTimes {
  private readonly checks = new Map<string, Distribution>()
  private readonly reviews = new Distribution()
  private readonly ends = new Distribution()

  constructor(events: readonly JournalEvent[]) {
    for (const event of events) {
      if (event.kind === 'check') this.ended(event.ms, event.checks)
      if (event.kind === 'review' && event.seconds > 0) this.reviews.add(event.seconds * 1000)
    }
  }

  check(id: string): number | null {
    return this.median(this.checks.get(id))
  }

  get review(): number | null {
    return this.median(this.reviews)
  }

  get whole(): number | null {
    return this.median(this.ends)
  }

  // A check skipped, or given again because nothing it reads changed, did not run.
  private ended(ms: number, runs: readonly CheckRun[]): void {
    this.ends.add(ms)

    for (const run of runs.filter((ran) => ran.status !== 'skip' && ran.kept !== true)) {
      const runsOfCheck = this.checks.get(run.id) ?? new Distribution()

      runsOfCheck.add(run.ms)
      this.checks.set(run.id, runsOfCheck)
    }
  }

  private median(distribution: Distribution | undefined): number | null {
    const numbers = distribution?.numbers

    return numbers === undefined || numbers.count === 0 ? null : numbers.median
  }
}
