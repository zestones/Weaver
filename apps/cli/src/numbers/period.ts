const DAY_MS = 24 * 60 * 60 * 1000

// The time the numbers are about: from a day on, or everything that was kept.
export class Period {
  // null when everything is counted.
  readonly since: Date | null

  private constructor(since: Date | null) {
    this.since = since
  }

  static whole(): Period {
    return new Period(null)
  }

  // A day, as `2026-10-01`, or a number of days back from now, as `7d`. null when the word is neither.
  static from(word: string, now: Date = new Date()): Period | null {
    const days = /^(\d+)d$/.exec(word)

    if (days !== null) return new Period(new Date(now.getTime() - Number(days[1]) * DAY_MS))

    const day = /^\d{4}-\d{2}-\d{2}$/.test(word) ? new Date(`${word}T00:00:00`) : null

    return day === null || Number.isNaN(day.getTime()) ? null : new Period(day)
  }

  holds(at: string | null | undefined): boolean {
    if (at === null || at === undefined) return false

    return this.since === null || Date.parse(at) >= this.since.getTime()
  }
}
