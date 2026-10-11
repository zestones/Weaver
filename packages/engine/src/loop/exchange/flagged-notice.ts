export class FlaggedNotice {
  readonly text: string | null

  constructor(cards: readonly number[]) {
    this.text =
      cards.length === 0 ? null : `[weaver] Flagged in this turn: ${cards.map((card) => `#${String(card)}`).join(', ')} (weaver cards).`
  }
}
