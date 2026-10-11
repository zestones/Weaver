import { distance } from '../../lib/text/distance.ts'

const WORD = /(?:^|\s)(#[a-z][a-z-]+)(?=$|[\s.,;:!?)])/gi
const KNOWN = ['#no-review', '#review', '#critical', '#simple']
const HEX_COLOUR = /^#[0-9a-f]{3,8}$/
const NEAR = 2

// The words the owner puts in a request to say how its work is reviewed.
export class OwnerDirectives {
  private readonly words: ReadonlySet<string>

  constructor(requests: readonly string[]) {
    this.words = new Set(requests.flatMap((request) => [...request.matchAll(WORD)].map((match) => (match[1] ?? '').toLowerCase())))
  }

  // One request of the unit that asks for a review is enough to have one.
  get skipsReview(): boolean {
    return this.words.has('#no-review') && !this.words.has('#review') && !this.words.has('#critical')
  }

  // Also asks for a review that failed to be tried again.
  get review(): boolean {
    return this.words.has('#review')
  }

  get critical(): boolean {
    return this.words.has('#critical')
  }

  get simple(): boolean {
    return this.words.has('#simple')
  }

  // A word that is almost a directive was probably meant as one, and would otherwise be ignored without a word.
  problems(): string[] {
    return [...this.words].flatMap((word) => {
      const meant = KNOWN.includes(word) || HEX_COLOUR.test(word) ? undefined : KNOWN.find((known) => distance(word, known) <= NEAR)

      return meant === undefined ? [] : [`${word} is not a directive: did you mean ${meant}?`]
    })
  }
}
