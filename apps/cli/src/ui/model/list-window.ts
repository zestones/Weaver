import type { Card } from '@weaver/memory'

// A row of the list: the name of a group of cards, a card, or how many cards are out of sight above or under.
export type ListRow =
  | { readonly kind: 'group'; readonly rank: number; readonly count: number }
  | { readonly kind: 'card'; readonly card: Card; readonly chosen: boolean }
  | { readonly kind: 'more'; readonly above: boolean; readonly count: number }

const HEIGHTS: Readonly<Record<ListRow['kind'], number>> = { group: 1, card: 2, more: 1 }
// One empty line sets two rows apart.
const GAP = 1

// The part of a list of cards that fits in the height of its pane, starting at one of its cards. Cards put in order
// by their level stand under the name of their level.
export class ListWindow {
  readonly rows: readonly ListRow[]
  // The cards in sight, by their place in the list: from `first`, up to and without `end`.
  readonly first: number
  readonly end: number

  // `rankOf` gives the group of a card; null when the cards are not grouped.
  constructor(cards: readonly Card[], rankOf: ((card: Card) => number) | null, chosen: number | null, first: number, height: number) {
    const start = Math.min(Math.max(0, first), Math.max(0, cards.length - 1))
    const ranks = rankOf === null ? null : cards.map((card) => rankOf(card))
    const groupAt = (at: number): ListRow[] => {
      const rank = ranks?.[at]

      return rank === undefined || (at > start && ranks?.[at - 1] === rank)
        ? []
        : [{ kind: 'group', rank, count: ranks?.filter((other) => other === rank).length ?? 0 }]
    }
    const above: ListRow[] = start > 0 ? [{ kind: 'more', above: true, count: start }] : []
    let rows: ListRow[] = [...above]
    let end = start

    while (end < cards.length) {
      const card = cards[end]

      if (card === undefined) break

      const added: ListRow[] = [...groupAt(end), { kind: 'card', card, chosen: card.number === chosen }]
      const left = cards.length - end - 1
      const under: ListRow[] = left > 0 ? [{ kind: 'more', above: false, count: left }] : []

      // A card is shown whole, or not at all; the first one always is, however low the pane.
      if (end > start && ListWindow.heightOf([...rows, ...added, ...under]) > height) break

      rows = [...rows, ...added]
      end += 1
    }

    this.first = start
    this.end = end
    this.rows = end < cards.length ? [...rows, { kind: 'more', above: false, count: cards.length - end }] : rows
  }

  // The first card to show so that the card at `cursor` is in sight, moving as little as possible from `first`.
  static startFor(cards: readonly Card[], rankOf: ((card: Card) => number) | null, cursor: number, first: number, height: number): number {
    let start = Math.min(first, cursor)

    while (start < cursor && new ListWindow(cards, rankOf, null, start, height).end <= cursor) start += 1

    return Math.max(0, start)
  }

  private static heightOf(rows: readonly ListRow[]): number {
    return rows.reduce((sum, row) => sum + HEIGHTS[row.kind], 0) + Math.max(0, rows.length - 1) * GAP
  }
}
