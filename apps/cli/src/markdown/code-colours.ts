import hljs from 'highlight.js/lib/common'
import type { Paint } from '../output/paint.ts'

type Style = (text: string) => string

// What the highlighter writes: a span that opens with the kind of what it holds, a span that closes, a character it
// had to escape, or text.
const PIECES = /<span class="([^"]*)">|<\/span>|&(amp|lt|gt|quot|#x27|#39);|[^<&]+|[<&]/g
const ESCAPED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'" }
const STEPPING_BACK = new Set(['comment', 'quote', 'meta', 'doctag'])
const QUOTED = new Set(['string', 'regexp', 'char', 'symbol', 'addition'])
const STRUCTURE = new Set(['keyword', 'literal', 'type', 'section', 'selector-tag'])

// The lines of a code block, coloured by the grammar of their language: comments step back, strings and keywords
// stand out, and nothing else is touched. A language the highlighter does not know is left as it is.
export class CodeColours {
  private readonly paint: Paint

  constructor(paint: Paint) {
    this.paint = paint
  }

  lines(code: string, language: string): string[] {
    if (language === '' || hljs.getLanguage(language) === undefined) return code.split('\n')

    return this.drawn(hljs.highlight(code, { language, ignoreIllegals: true }).value)
  }

  // A run of text in one style is drawn at once, in the style of the nearest span that has one, and ends with its
  // line: a style never runs over the end of a line.
  private drawn(highlighted: string): string[] {
    const lines = ['']
    const open: (Style | null)[] = []
    let run = ''
    let runStyle: Style | null = null
    const flush = (): void => {
      lines[lines.length - 1] = `${lines.at(-1) ?? ''}${runStyle === null ? run : runStyle(run)}`
      run = ''
    }

    for (const [piece, kinds, escaped] of highlighted.matchAll(PIECES)) {
      if (kinds !== undefined) {
        open.push(this.styleOf(kinds))
      } else if (piece === '</span>') {
        open.pop()
      } else {
        const style = open.findLast((each) => each !== null) ?? null
        const [first = '', ...others] = (escaped === undefined ? piece : (ESCAPED[escaped] ?? piece)).split('\n')

        if (style !== runStyle) flush()

        runStyle = style
        run += first

        for (const line of others) {
          flush()
          lines.push('')
          run = line
        }
      }
    }

    flush()

    return lines
  }

  private styleOf(kinds: string): Style | null {
    const kind = kinds.split(' ')[0]?.replace(/^hljs-/, '') ?? ''

    if (STEPPING_BACK.has(kind)) return (text) => this.paint.dim(text)
    if (QUOTED.has(kind)) return (text) => this.paint.green(text)
    if (kind === 'deletion') return (text) => this.paint.red(text)

    return STRUCTURE.has(kind) ? (text) => this.paint.bold(text) : null
  }
}
