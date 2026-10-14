import type { Conclusion } from '../cards/card-record.ts'
import { NoteReport } from './note-report.ts'

const NUMBER = /^\d+$/
const RULES =
  'The first reports an investigation: confirmed when what the card says is true, refuted when it is not, unsure when you could not tell. The second reports a fix. When you looked into the card and then fixed it, write both, in that order. Each keyword starts a line. A field may span lines, and may say that there is nothing to say. Without a word, a note concludes nothing and is free text.'

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

  // The format with the number of a card in it, for an agent that reads this card: one command for each report.
  static formatFor(card: string): string {
    const reports = NoteReport.KINDS.map((kind) => {
      const words = NoteText.CONCLUSIONS.filter((word) => NoteReport.kindOf(word) === kind)

      return [`weaver note ${card} ${words.join('|')} <<'EOF'`, ...NoteReport.asked(kind), 'EOF'].join('\n')
    })

    return [...reports, RULES].join('\n\n')
  }

  // Empty when the note can be written.
  problems(): string[] {
    return [
      ...(this.card === null ? ['The note names no card: the number of the card comes first.'] : []),
      ...(this.text === '' ? ['The note says nothing: say what you did, and what it showed.'] : []),
    ]
  }
}
