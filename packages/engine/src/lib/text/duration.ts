const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

// A length of time as a person says it: `14 s`, `21 min 40 s`, `1 h 5 min`.
export function duration(ms: number): string {
  if (ms < MINUTE) return `${String(Math.floor(ms / SECOND))} s`
  if (ms < HOUR) return `${String(Math.floor(ms / MINUTE))} min ${String(Math.floor((ms % MINUTE) / SECOND))} s`

  return `${String(Math.floor(ms / HOUR))} h ${String(Math.floor((ms % HOUR) / MINUTE))} min`
}
