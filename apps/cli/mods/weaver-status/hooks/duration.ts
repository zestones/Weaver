const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

// A length of time as a person says it: `14 s`, `21 min 40 s`, `1 h 5 min`.
export class Duration {
  readonly text: string

  constructor(ms: number) {
    const lasted = Math.max(0, ms)
    const whole = (unit: number, within = Number.POSITIVE_INFINITY): string => String(Math.floor((lasted % within) / unit))

    if (lasted < MINUTE) this.text = `${whole(SECOND)} s`
    else if (lasted < HOUR) this.text = `${whole(MINUTE)} min ${whole(SECOND, MINUTE)} s`
    else this.text = `${whole(HOUR)} h ${whole(MINUTE, HOUR)} min`
  }
}
