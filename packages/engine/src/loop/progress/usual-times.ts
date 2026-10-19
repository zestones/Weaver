import type { CheckRun, JournalEvent } from '../../unit-of-work/journal/journal-event.ts'

// How long the parts of an end of task usually take in a project: the median of what its journal kept of them. A part
// never measured has no usual time.
export class UsualTimes {
  private readonly checks = new Map<string, number[]>()
  private readonly reviews: number[] = []
  private readonly ends: number[] = []

  constructor(events: readonly JournalEvent[]) {
    for (const event of events) {
      if (event.kind === 'check') this.ended(event.ms, event.checks)
      if (event.kind === 'review' && event.seconds > 0) this.reviews.push(event.seconds * 1000)
    }
  }

  check(id: string): number | null {
    return this.median(this.checks.get(id) ?? [])
  }

  get review(): number | null {
    return this.median(this.reviews)
  }

  get whole(): number | null {
    return this.median(this.ends)
  }

  // A check skipped, or given again because nothing it reads changed, did not run.
  private ended(ms: number, runs: readonly CheckRun[]): void {
    this.ends.push(ms)

    for (const run of runs.filter((ran) => ran.status !== 'skip' && ran.kept !== true))
      this.checks.set(run.id, [...(this.checks.get(run.id) ?? []), run.ms])
  }

  // The nearest rank, so that it is always a time that was measured.
  private median(values: readonly number[]): number | null {
    const sorted = [...values].sort((one, other) => one - other)

    return sorted[Math.ceil(sorted.length / 2) - 1] ?? null
  }
}
