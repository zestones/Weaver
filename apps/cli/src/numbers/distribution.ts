// What is said of a series of measures, whatever their unit: milliseconds, files, lines.
export interface DistributionNumbers {
  readonly count: number
  readonly median: number
  // Nine measures in ten are at or under this one.
  readonly ninthDecile: number
  readonly largest: number
  readonly total: number
}

export class Distribution {
  private readonly values: number[] = []

  add(value: number): void {
    this.values.push(value)
  }

  get numbers(): DistributionNumbers {
    const sorted = [...this.values].sort((one, other) => one - other)

    return {
      count: sorted.length,
      median: this.at(sorted, 0.5),
      ninthDecile: this.at(sorted, 0.9),
      largest: sorted.at(-1) ?? 0,
      total: sorted.reduce((sum, value) => sum + value, 0),
    }
  }

  // The measure a share of the series is at or under: the nearest rank, so that it is always a measure that was made.
  private at(sorted: readonly number[], share: number): number {
    return sorted[Math.max(0, Math.ceil(sorted.length * share) - 1)] ?? 0
  }
}
