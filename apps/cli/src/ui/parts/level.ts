import type { Tone } from '../theme/marks.ts'

// How a level of the project's scale is shown: its name, and the tone that says how grave it is. The first value
// of a scale is the gravest and the second comes next; the last one of a scale of three or more is the least, and a
// card with no level is said to have none.
export class Level {
  readonly name: string
  readonly tone: Tone

  constructor(scale: readonly string[], rank: number) {
    const last = scale.length - 1

    this.name = (scale[rank] ?? 'no level').toUpperCase()
    this.tone = rank === 0 ? 'coral' : rank === 1 ? 'orange' : rank >= scale.length || (rank === last && last >= 2) ? 'quiet' : 'neutral'
  }
}
