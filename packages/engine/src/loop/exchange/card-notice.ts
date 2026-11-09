import type { Card } from '@weaver/memory'

// What an agent is told when a call changes the files of cards that wait for the owner: it may be settling them, and
// the owner reads on a card what was done about it.
export class CardNotice {
  readonly text: string | null

  // `changed` are the files the call changed.
  constructor(cards: readonly Card[], changed: readonly string[]) {
    this.text =
      cards.length === 0
        ? null
        : [
            '[weaver] Open cards on changed files:',
            ...cards.map((card) => `- #${String(card.number)} ${card.title} (${this.filesOf(card, changed).join(', ')})`),
            'Read with `weaver cards <number>`; resolve actionable cards in scope and document with `weaver note`.',
          ].join('\n')
  }

  private filesOf(card: Card, changed: readonly string[]): string[] {
    return [...new Set(card.places.map((place) => place.file))].filter((file) => changed.includes(file))
  }
}
