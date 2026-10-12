import type { Token, Tokens } from 'marked'
import type { Paint } from '../output/paint.ts'
import type { Atom } from './atom.ts'

type Style = (word: string) => string
type Add = (raw: string, style: Style) => void

// What a parser of Markdown found inside a line, as atoms: each word drawn by itself, so that a line may be broken
// between any two of them without a style running over the break.
export class InlineMarkdown {
  private readonly paint: Paint

  constructor(paint: Paint) {
    this.paint = paint
  }

  atoms(tokens: readonly Token[], overall: Style = (word) => word): Atom[] {
    const atoms: Atom[] = []
    // Whether the next piece touches the atom before it: a full stop after a word in code belongs to that word.
    let glued = false

    this.walk(tokens, overall, (raw, style) => {
      for (const part of raw.split(/(\s+)/)) {
        if (part === '') continue

        if (/^\s+$/.test(part)) {
          glued = false
          continue
        }

        const last = atoms.at(-1)

        if (glued && last !== undefined) atoms[atoms.length - 1] = { text: `${last.text}${style(part)}`, width: last.width + part.length }
        else atoms.push({ text: style(part), width: part.length })

        glued = true
      }
    })

    return atoms
  }

  // A mark inside another keeps both: a word of code in a strong sentence is strong and in the colour of code.
  private walk(tokens: readonly Token[], style: Style, add: Add): void {
    for (const token of tokens) {
      if (token.type === 'codespan') add((token as Tokens.Codespan).text, (word) => style(this.paint.cyan(word)))
      else if (token.type === 'strong') this.walk((token as Tokens.Strong).tokens, (word) => style(this.paint.bold(word)), add)
      else if (token.type === 'em') this.walk((token as Tokens.Em).tokens, (word) => style(this.paint.italic(word)), add)
      else if (token.type === 'del') this.walk((token as Tokens.Del).tokens, (word) => style(this.paint.dim(word)), add)
      else if (token.type === 'link') this.link(token as Tokens.Link, style, add)
      else if (token.type === 'br') add(' ', style)
      else if (token.type === 'text' && (token as Tokens.Text).tokens !== undefined)
        this.walk((token as Tokens.Text).tokens ?? [], style, add)
      else add(this.textOf(token), style)
    }
  }

  // The words of a link, then where it leads, which a terminal cannot hide behind them.
  private link(link: Tokens.Link, style: Style, add: Add): void {
    this.walk(link.tokens, style, add)
    if (link.href !== link.text) add(` (${link.href})`, (word) => this.paint.dim(word))
  }

  private textOf(token: Token): string {
    return 'text' in token && typeof token.text === 'string' ? token.text : token.raw
  }
}
