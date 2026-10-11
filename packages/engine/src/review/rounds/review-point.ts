import type { Place, ReviewContent } from '@weaver/memory'

// What a review leaves for the owner once its unit ends: a finding its author did not fix, or a suspicion of the
// reviewer. It becomes a card.
export interface ReviewPoint {
  readonly origin: 'finding' | 'suspicion'
  // null for a suspicion that names no file.
  readonly place: Place | null
  // What the rule asks is the declaration's to say.
  readonly content: Omit<ReviewContent, 'statement'>
}
