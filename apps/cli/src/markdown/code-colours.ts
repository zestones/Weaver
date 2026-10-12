import hljs from 'highlight.js/lib/common'
import type { Paint } from '../output/paint.ts'

type Style = (text: string) => string

// A stretch of a line in one style; null where the line is left as it is.
interface Run {
  readonly text: string
  readonly style: Style | null
}

// What the highlighter writes: a span that opens with the kind of what it holds, a span that closes, a character it
// had to escape, or text.
const PIECES = /<span class="([^"]*)">|<\/span>|&(amp|lt|gt|quot|#x27|#39);|[^<&]+|[<&]/g
const ESCAPED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'" }
// `plain` is the colour of the text around: what a string holds between braces is code again, not a string.
type Ink = 'plain' | 'bold' | 'italic' | 'dim' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan'

// The colour of each kind of thing a grammar names, taken from the palette of the terminal so that code follows the
// theme of its owner. A kind is looked up with what narrows it first: `title class_`, then `title`.
const THEME: Readonly<Record<string, Ink>> = {
  comment: 'dim',
  quote: 'dim',
  doctag: 'dim',
  keyword: 'magenta',
  'selector-tag': 'magenta',
  'template-tag': 'magenta',
  string: 'green',
  regexp: 'green',
  char: 'green',
  symbol: 'green',
  addition: 'green',
  subst: 'plain',
  number: 'yellow',
  literal: 'yellow',
  bullet: 'yellow',
  title: 'blue',
  section: 'blue',
  attr: 'blue',
  attribute: 'blue',
  name: 'blue',
  'title class_': 'cyan',
  type: 'cyan',
  built_in: 'cyan',
  meta: 'cyan',
  variable: 'cyan',
  'template-variable': 'cyan',
  // `self` and `this` are on every line of a method: coloured, they would be all one sees.
  'variable language_': 'plain',
  deletion: 'red',
  strong: 'bold',
  emphasis: 'italic',
}

// The lines of a code block, coloured by the grammar of their language. A language the highlighter does not know is
// left as it is.
export class CodeColours {
  private readonly paint: Paint

  constructor(paint: Paint) {
    this.paint = paint
  }

  // Each line as the rows it takes on a page `room` wide: a line longer than the page goes on on the next row, and a
  // style never runs over the end of a row.
  rows(code: string, language: string, room: number): string[][] {
    const known = language !== '' && hljs.getLanguage(language) !== undefined
    const lines = known
      ? this.runs(hljs.highlight(code, { language, ignoreIllegals: true }).value)
      : code.split('\n').map((text): Run[] => [{ text, style: null }])

    return lines.map((line) => this.folded(line, room))
  }

  private folded(runs: readonly Run[], room: number): string[] {
    const line = runs.map((run) => run.text).join('')
    const rows: string[] = []
    let row = ''
    let at = 0
    let end = this.rowEnd(line, at, room)

    for (const { text, style } of runs) {
      for (let rest = text; rest !== '';) {
        if (at === end) {
          rows.push(row)
          row = ''
          end = this.rowEnd(line, at, room)
        }

        const piece = rest.slice(0, end - at)

        row += style === null ? piece : style(piece)
        at += piece.length
        rest = rest.slice(piece.length)
      }
    }

    return [...rows, row]
  }

  // Where the row that starts at `from` ends: after a space when one is near enough, so that a word is only cut
  // when nothing else can be.
  private rowEnd(line: string, from: number, room: number): number {
    if (line.length - from <= room) return line.length

    const space = line.lastIndexOf(' ', from + room - 1)

    return space >= from + room / 2 ? space + 1 : from + room
  }

  // What the highlighter wrote, as the lines of the code: each stretch in the style of the nearest span that has one.
  private runs(highlighted: string): Run[][] {
    const lines: Run[][] = [[]]
    const open: (Style | null)[] = []
    // A stretch goes on the one before it when both are in one style: a string that holds a quote is drawn at once.
    const add = (text: string, style: Style | null): void => {
      const line = lines.at(-1) ?? []
      const last = line.at(-1)

      if (last?.style === style) line[line.length - 1] = { text: `${last.text}${text}`, style }
      else line.push({ text, style })
    }

    for (const [piece, kinds, escaped] of highlighted.matchAll(PIECES)) {
      if (kinds !== undefined) {
        open.push(this.styleOf(kinds))
      } else if (piece === '</span>') {
        open.pop()
      } else {
        const style = open.findLast((each) => each !== null) ?? null
        const [first = '', ...others] = (escaped === undefined ? piece : (ESCAPED[escaped] ?? piece)).split('\n')

        add(first, style)

        for (const line of others) {
          lines.push([])
          add(line, style)
        }
      }
    }

    return lines
  }

  private styleOf(kinds: string): Style | null {
    const [kind = '', narrowed = ''] = kinds.replace(/^hljs-/, '').split(' ')
    const ink = THEME[`${kind} ${narrowed}`] ?? THEME[kind]

    if (ink === undefined) return null

    return ink === 'plain' ? (text) => text : (text) => this.paint[ink](text)
  }
}
