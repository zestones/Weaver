import { Card } from '@weaver/memory'
import type { Tone } from '../theme/marks.ts'

// How a way of closing a card is shown at the head of the cards closed that way: its name, in the tone of the
// conclusion it answers. Fixed is said as an agent that fixed it says it, invalid as one that refuted the card; a
// card left as it is and one that became an issue say nothing by their colour.
export class ClosedAs {
  readonly name: string
  readonly tone: Tone

  // `rank` is the place of the way among those a card closes in.
  constructor(rank: number) {
    const closing = Card.CLOSINGS[rank]

    this.name = (closing ?? 'not closed').toUpperCase()
    this.tone = closing === 'fixed' ? 'blue' : closing === 'invalid' ? 'coral' : 'neutral'
  }
}
