import type { Closing } from '../cards/card-record.ts'
import { Card } from '../cards/card.ts'
import { LabelFamilies } from '../cards/label-families.ts'
import { PlaceText } from '../flags/place-text.ts'

// level: the gravest first, by the family of labels the project grades its cards with. closing: by how they were
// closed, the last closed first in each way. newest: the last made first.
export type CardOrder = 'level' | 'closing' | 'newest'

// What a list of cards is narrowed to. Each part left out narrows nothing.
export interface Narrowing {
  // A family of labels, then the values wanted: a card is kept when it carries one of them, in every family named.
  readonly labels?: Readonly<Record<string, readonly string[]>>
  // Only the cards made at this moment or after it.
  readonly since?: string | null
  // Only the cards someone concluded on.
  readonly answered?: boolean
  // Only the cards closed in one of these ways.
  readonly closedAs?: readonly Closing[]
  // Words that what the card says must all hold, in any letter case.
  readonly words?: string
}

// Cards as the owner goes through them: narrowed, counted and put in order. The commands and the interface list the
// cards through it, so that both show the same ones.
export class CardListing {
  readonly cards: readonly Card[]
  private readonly scale: readonly string[]

  // `scale` is the values of the grading family in the order the project declares them; empty when it has none.
  constructor(cards: readonly Card[], scale: readonly string[] = []) {
    this.cards = cards
    this.scale = scale
  }

  narrowed({ labels = {}, since = null, answered = false, closedAs = [], words = '' }: Narrowing): CardListing {
    const wanted = Object.entries(labels).filter(([, values]) => values.length > 0)
    const looked = words
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word !== '')
    const kept = this.cards.filter(
      (card) =>
        wanted.every(([family, values]) => card.valuesOf(family).some((value) => values.includes(value))) &&
        (since === null || card.record.provenance.at >= since) &&
        (!answered || card.conclusion !== null) &&
        (closedAs.length === 0 || closedAs.some((closing) => closing === card.record.closing?.as)) &&
        (looked.length === 0 || this.holds(card, looked)),
    )

    return new CardListing(kept, this.scale)
  }

  ordered(order: CardOrder): Card[] {
    const newest = this.cards.toSorted((a, b) => b.number - a.number)
    const closedAt = (card: Card): string => card.record.closing?.at ?? ''

    if (order === 'newest') return newest
    if (order === 'level') return newest.toSorted((a, b) => this.rankOf(a) - this.rankOf(b))

    return newest.toSorted((a, b) => this.closingRankOf(a) - this.closingRankOf(b) || closedAt(b).localeCompare(closedAt(a)))
  }

  // How many of the cards carry each value of a family.
  counts(family: string): Record<string, number> {
    const counts: Record<string, number> = {}

    for (const value of this.cards.flatMap((card) => card.valuesOf(family))) counts[value] = (counts[value] ?? 0) + 1

    return counts
  }

  // Where a card stands on the scale: 0 for the gravest value, and after every value for a card that has none.
  rankOf(card: Card): number {
    const ranks = card.valuesOf(LabelFamilies.LEVEL).flatMap((value) => (this.scale.includes(value) ? [this.scale.indexOf(value)] : []))

    return ranks.length === 0 ? this.scale.length : Math.min(...ranks)
  }

  // Where a card stands among the ways a card closes, in the order the owner is offered them; after every way for
  // a card that is not closed.
  closingRankOf(card: Card): number {
    const closing = card.record.closing?.as

    return closing === undefined ? Card.CLOSINGS.length : Card.CLOSINGS.indexOf(closing)
  }

  private holds(card: Card, words: readonly string[]): boolean {
    const { flag, review, written, notes, closing } = card.record
    const said = [
      `#${String(card.number)}`,
      card.title,
      ...card.places.map((place) => PlaceText.write(place)),
      ...card.labels(),
      flag?.text ?? '',
      review?.message ?? '',
      ...(written?.sections ?? []).map((section) => section.text),
      ...notes.map((note) => note.text),
      // How a card was closed is part of what it says: the way, the reason given, and the issue it became.
      ...(closing === null ? [] : [closing.as, closing.reason ?? '', closing.issue ?? '']),
    ]
      .join('\n')
      .toLowerCase()

    return words.every((word) => said.includes(word))
  }
}
