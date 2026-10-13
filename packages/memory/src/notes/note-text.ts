import type { Conclusion } from '../cards/card-record.ts'

const NUMBER = /^\d+$/

// Reads a note as it is typed: the number of its card, what it concludes if it does, then what it says.
export class NoteText {
  static readonly CONCLUSIONS: readonly Conclusion[] = ['confirmed', 'refuted', 'unsure', 'fixed']
  // The format, for an agent that got it wrong: shown under the problems.
  static readonly FORMAT: string = NoteText.formatFor('<number>')

  // null when the first word is not the number of a card.
  readonly card: number | null
  readonly conclusion: Conclusion | null
  readonly text: string

  // `words` are what follows the command, `body` what it was given to read: a note says its text in either.
  constructor(words: readonly string[], body: string | null) {
    const [number = '', ...rest] = words
    const conclusion = NoteText.CONCLUSIONS.find((known) => known === rest[0]) ?? null
    const said = [rest.slice(conclusion === null ? 0 : 1).join(' '), body ?? '']

    this.card = NUMBER.test(number) ? Number(number) : null
    this.conclusion = conclusion
    this.text = said
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .join('\n\n')
  }

  // The format with the number of a card in it, for an agent that reads this card.
  static formatFor(card: string): string {
    return [
      `weaver note ${card} ${NoteText.CONCLUSIONS.join('|')} <<'EOF'`,
      'What you ran and what it showed, what you only read, and what you changed.',
      'EOF',
      'The word says what you conclude of the card: confirmed when what it says is true, refuted when it is not, unsure when you could not tell, fixed when you fixed it. Leave the word out for a note that concludes nothing.',
    ].join('\n')
  }

  // Empty when the note can be written.
  problems(): string[] {
    return [
      ...(this.card === null ? ['The note names no card: the number of the card comes first.'] : []),
      ...(this.text === '' ? ['The note says nothing: say what you did, and what it showed.'] : []),
    ]
  }
}
