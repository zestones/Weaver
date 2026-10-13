import type { Key } from 'ink'

// What is being typed in a field. Letters are added at its end and taken off there: a field of the interface holds a
// few words, and a longer text is written in the owner's editor.
export class TypedText {
  readonly text: string
  private readonly lines: boolean

  // `lines` is for a field that takes several: Enter then starts a new one.
  constructor(text = '', lines = false) {
    this.text = text
    this.lines = lines
  }

  // The field after a key; null when the key is not one a field takes.
  pressed(input: string, key: Key): TypedText | null {
    if (key.backspace || key.delete) return this.with([...this.text].slice(0, -1).join(''))
    if (key.ctrl && input === 'u') return this.with('')
    if (key.return) return this.lines ? this.with(`${this.text}\n`) : null
    if (key.ctrl || key.meta || key.escape || key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) return null

    // What is pasted comes in one piece, with the line ends of where it was copied.
    const typed = input.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
    const kept = this.lines ? typed : typed.replaceAll('\n', ' ')

    return kept === '' ? null : this.with(`${this.text}${kept}`)
  }

  with(text: string): TypedText {
    return new TypedText(text, this.lines)
  }
}
