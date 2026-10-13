import { Paint } from '../../output/paint.ts'
import { THEME } from './theme.ts'

const ESCAPE = '\u001B['
const INK = 38
const GROUND = 48

// The paint of the interface: the same styles as a page of the command line, in the colours of the theme. A terminal
// that draws sixteen million colours is asked for them by their numbers; each style gives the line back to the ivory
// and to the ground of its pane when it ends, since the terminal's own colours are not those of the interface.
export class ThemePaint extends Paint {
  private readonly pane: string

  // `pane` is the ground the lines are drawn on.
  constructor(pane: string = THEME.panel) {
    super(true)
    this.pane = pane
  }

  override get grounds(): boolean {
    return true
  }

  override dim(text: string): string {
    return this.inked(THEME.muted, text)
  }

  override green(text: string): string {
    return this.inked(THEME.green.ink, text)
  }

  override red(text: string): string {
    return this.inked(THEME.coral.ink, text)
  }

  override yellow(text: string): string {
    return this.inked(THEME.orange.ink, text)
  }

  override blue(text: string): string {
    return this.inked(THEME.blue.ink, text)
  }

  // What a language reserves, and the mark of the line that matters: the gold of the theme.
  override magenta(text: string): string {
    return this.inked(THEME.gold, text)
  }

  // What a language names, as its types: the blue of the theme, which the names of functions take too.
  override cyan(text: string): string {
    return this.inked(THEME.blue.ink, text)
  }

  // A word of code inside a sentence stands on a chip.
  override code(text: string): string {
    return this.grounded(THEME.raised, text)
  }

  override inset(text: string): string {
    return this.grounded(THEME.ground, text)
  }

  override raised(text: string): string {
    return this.grounded(THEME.raised, text)
  }

  private inked(colour: string, text: string): string {
    return text === '' ? text : `${this.escape(INK, colour)}${text}${this.escape(INK, THEME.ivory)}`
  }

  private grounded(colour: string, text: string): string {
    return text === '' ? text : `${this.escape(GROUND, colour)}${text}${this.escape(GROUND, this.pane)}`
  }

  private escape(layer: number, colour: string): string {
    const [red, green, blue] = [1, 3, 5].map((at) => String(Number.parseInt(colour.slice(at, at + 2), 16)))

    return `${ESCAPE}${String(layer)};2;${String(red)};${String(green)};${String(blue)}m`
  }
}
