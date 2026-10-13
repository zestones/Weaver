import { NoteText, type Card, type Conclusion } from '@weaver/memory'
import type { Key } from 'ink'
import type { Form } from './form.ts'
import { TypedText } from './typed-text.ts'

interface Fields {
  readonly conclusion: Conclusion | null
  readonly text: TypedText
  readonly outcome: Form['outcome']
  readonly problem: string | null
  readonly editing: boolean
}

// Writing a note on a card: what it says and, when the owner concludes, what they conclude of the card.
export class NoteForm implements Form {
  // What a note may conclude, with nothing first: most notes of the owner conclude nothing.
  static readonly CONCLUSIONS: readonly (Conclusion | null)[] = [null, ...NoteText.CONCLUSIONS]

  readonly card: Card
  readonly conclusion: Conclusion | null
  readonly text: TypedText
  readonly outcome: Form['outcome']
  readonly problem: string | null
  // true once the owner asked for their editor: the interface hands it the text, and takes back what it saved.
  readonly editing: boolean

  private constructor(card: Card, fields: Fields) {
    this.card = card
    this.conclusion = fields.conclusion
    this.text = fields.text
    this.outcome = fields.outcome
    this.problem = fields.problem
    this.editing = fields.editing
  }

  static for(card: Card): NoteForm {
    return new NoteForm(card, { conclusion: null, text: new TypedText('', true), outcome: 'open', problem: null, editing: false })
  }

  pressed(input: string, key: Key): NoteForm {
    if (key.escape) return this.with({ outcome: 'cancelled' })
    if (key.ctrl && input === 's') return this.with({ outcome: 'submitted' })
    if (key.ctrl && input === 'e') return this.with({ editing: true })
    if (key.tab) {
      const at = NoteForm.CONCLUSIONS.indexOf(this.conclusion)
      const step = key.shift ? NoteForm.CONCLUSIONS.length - 1 : 1

      return this.with({ conclusion: NoteForm.CONCLUSIONS[(at + step) % NoteForm.CONCLUSIONS.length] ?? null })
    }

    return this.with({ text: this.text.pressed(input, key) ?? this.text, problem: null })
  }

  // What the owner saved in their editor is the text of the note.
  edited(text: string): NoteForm {
    return this.with({ text: this.text.with(text.trimEnd()), editing: false })
  }

  refused(problem: string): NoteForm {
    return this.with({ outcome: 'open', problem })
  }

  private with(change: Partial<Fields>): NoteForm {
    const { conclusion, text, outcome, problem, editing } = this

    return new NoteForm(this.card, { conclusion, text, outcome, problem, editing, ...change })
  }
}
