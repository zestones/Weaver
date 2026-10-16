import { NoteText, type Card } from '@weaver/memory'

// What holds the end of a task about cards that wait for the owner, until its agent writes on them what it did: the
// owner reads a card to decide on it, and a final message is read once.
export class CardNotesWanted {
  readonly text: string | null

  // `changed` are the files of the unit of work.
  constructor(cards: readonly Card[], changed: readonly string[]) {
    this.text =
      cards.length === 0
        ? null
        : [
            '[weaver] This task is about cards that wait for the owner, and nothing was written on them during it:',
            ...cards.map((card) => `- #${String(card.number)} ${card.title}: ${this.why(card, changed)}`),
            '',
            'On each one your work settled or advanced, write what you looked into, then what you changed, with the number of the card:',
            '',
            NoteText.FORMAT,
            '',
            'A card your task leaves as it was needs no note: say so in a line of your final message. Then end your task again with your final message. Weaver asks this once, and checks your work then.',
          ].join('\n')
  }

  private why(card: Card, changed: readonly string[]): string {
    const files = [...new Set(card.places.map((place) => place.file))].filter((file) => changed.includes(file))

    return files.length === 0 ? 'you read it' : `your work changed ${files.join(', ')}`
  }
}
