import type { Paint } from '../output/paint.ts'
import { CodeColours } from './code-colours.ts'
import { WrappedLines } from './wrapped-lines.ts'

// One line of a file, with the number it has there.
export interface NumberedLine {
  readonly number: number
  readonly text: string
}

const BAR = '│'
const MARK = '▸'
const INDENT = '  '
const NARROWEST = 20
// The language a file is written in, by how its name ends, for the ones the grammars know under another name.
const BY_ENDING: Readonly<Record<string, string>> = {
  py: 'python',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  sh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  html: 'xml',
  rs: 'rust',
  rb: 'ruby',
  kt: 'kotlin',
  h: 'c',
  toml: 'ini',
}

// Code as it is set apart on a page: coloured by its language, brought back to the margin, each line behind a bar.
// A line longer than the page goes on under the bar: left to the terminal, it would start again at the edge of the
// screen and break the page. Where the paint has grounds, code stands on one instead of behind a bar.
export class DrawnCode {
  private readonly paint: Paint
  private readonly colours: CodeColours
  private readonly width: number
  private readonly measure: WrappedLines

  constructor(paint: Paint, width: number) {
    this.paint = paint
    this.colours = new CodeColours(paint)
    this.width = width
    this.measure = new WrappedLines(width)
  }

  // The language of a file, as the grammars name it.
  static languageOf(file: string): string {
    const ending = /\.([A-Za-z0-9]+)$/.exec(file)?.[1]?.toLowerCase() ?? ''

    return BY_ENDING[ending] ?? ending
  }

  block(code: string, language: string): string[] {
    const start = `${INDENT}${this.paint.dim(BAR)} `

    if (this.paint.grounds)
      return this.onGround(this.rows(code.split('\n'), language, 2).flatMap((rows) => rows.map((row) => [row, false])))

    return this.rows(code.split('\n'), language, INDENT.length + 2).flatMap((rows) => rows.map((row) => `${start}${row}`.trimEnd()))
  }

  // Lines of a file under their numbers, the one that matters pointed at.
  excerpt(lines: readonly NumberedLine[], language: string, marked: number | null): string[] {
    const digits = Math.max(...lines.map((line) => String(line.number).length))

    if (this.paint.grounds) return this.numbered(lines, language, marked, digits)

    const bar = this.paint.dim(BAR)
    const rows = this.rows(
      lines.map((line) => line.text),
      language,
      INDENT.length + digits + 3,
    )

    return lines.flatMap(({ number }, index) => {
      const label = String(number).padStart(digits)
      const gutter = number === marked ? `${this.paint.yellow(MARK)} ${this.paint.bold(label)}` : `${INDENT}${this.paint.dim(label)}`
      const [first = '', ...others] = rows[index] ?? []
      const under = ' '.repeat(INDENT.length + digits)

      return [`${gutter} ${bar} ${first}`, ...others.map((row) => `${under} ${bar} ${row}`)].map((row) => row.trimEnd())
    })
  }

  private numbered(lines: readonly NumberedLine[], language: string, marked: number | null, digits: number): string[] {
    const rows = this.rows(
      lines.map((line) => line.text),
      language,
      digits + 6,
    )

    return this.onGround(
      lines.flatMap(({ number }, index) => {
        const label = String(number).padStart(digits)
        const gutter = number === marked ? `${this.paint.magenta(MARK)} ${this.paint.bold(label)}` : `${INDENT}${this.paint.dim(label)}`
        const [first = '', ...others] = rows[index] ?? []

        return [`${gutter}${INDENT}${first}`, ...others.map((row) => `${' '.repeat(digits + 4)}${row}`)].map(
          (row): readonly [string, boolean] => [row, number === marked],
        )
      }),
    )
  }

  // Each row fills the width of the page, so that the ground is one block, with an empty row above and under it.
  private onGround(rows: readonly (readonly [text: string, marked: boolean])[]): string[] {
    const filled = (text: string): string => ` ${text}${' '.repeat(Math.max(0, this.width - 2 - this.measure.visible(text)))} `

    return [
      this.paint.inset(filled('')),
      ...rows.map(([text, marked]) => (marked ? this.paint.raised(filled(text)) : this.paint.inset(filled(text)))),
      this.paint.inset(filled('')),
    ]
  }

  // The margin the lines share is taken off, and each line is given as the rows it takes in what is left of the page.
  private rows(lines: readonly string[], language: string, taken: number): string[][] {
    const margins = lines.filter((line) => line.trim() !== '').map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0)
    const margin = margins.length === 0 ? 0 : Math.min(...margins)
    const code = lines.map((line) => line.slice(margin).replaceAll('\t', INDENT)).join('\n')

    return this.colours.rows(code, language, Math.max(NARROWEST, this.width - taken))
  }
}
