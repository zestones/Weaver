import { NoteText, type Card } from '@weaver/memory'

export class CardNotesWanted {
  readonly text: string | null

  constructor(cards: readonly Card[], changed: readonly string[]) {
    this.text =
      cards.length === 0
        ? null
        : [
            '[weaver] Finish the card loop for these changed files (once for this unit):',
            ...cards.map(
              (card) =>
                `- #${String(card.number)} ${card.title}: ${card.places
                  .filter((place) => changed.includes(place.file))
                  .map((place) => place.file)
                  .join(
                    ', ',
                  )}; ${card.decision.kind === 'none' ? 'claimed for resolution' : card.decision.kind === 'owner' ? `owner decision: ${card.decision.question ?? ''}` : 'decision unknown'}.`,
            ),
            '',
            'Resolve the claimed cards within your task’s reach: investigate, fix and verify, then document each with notes. Spend at most 10 minutes on this pass and handle at most 2 cards. Claims expire after 10 minutes; stop work on the card then.',
            'For other cards, document only what this task settled or advanced. Leave pending owner decisions explicit; do not resolve them on the owner’s behalf.',
            'If a claimed card is out of reach, write a deferred note with the reason and name it in your final message. It stays open, distinct from needs-owner. Only the owner closes.',
            '',
            NoteText.FORMAT,
            '',
            'Then end with your final message. Weaver asks once per unit and checks your work next, without another card hold.',
          ].join('\n')
  }
}
