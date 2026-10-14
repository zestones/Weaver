import { NoteReport, type Card, type CardNote } from '@weaver/memory'

// The sides of a card in the interface: what was written of it, the flag it comes from, then what was written on it
// since, apart: what was looked into, what was changed, and the notes that conclude nothing.
export type SheetTab = 'card' | 'flag' | 'investigation' | 'fix' | 'notes'

// What was written on each side of a card. Every card has the five sides, in one place and under one digit, whether
// or not something was written on the last three.
export class CardSides {
  static readonly TABS: readonly SheetTab[] = ['card', 'flag', 'investigation', 'fix', 'notes']

  private readonly card: Card

  constructor(card: Card) {
    this.card = card
  }

  // Whether there is something to read on a side: there always is of the card and of its flag.
  holds(tab: SheetTab): boolean {
    return tab === 'card' || tab === 'flag' || this.countOf(tab) > 0
  }

  // How many reports or notes a side holds.
  countOf(tab: SheetTab): number {
    return this.notesOf(tab).length + (tab === 'fix' && this.bornFixed ? 1 : 0)
  }

  // The notes of a side, in the order they were written.
  notesOf(tab: SheetTab): CardNote[] {
    return this.card.record.notes.filter(({ conclusion }) => (NoteReport.kindOf(conclusion) ?? 'notes') === tab)
  }

  // A flag that says its author fixed the thing is the first fix its card reports.
  get bornFixed(): boolean {
    return this.card.record.flag?.fields.did === 'fixed'
  }
}
