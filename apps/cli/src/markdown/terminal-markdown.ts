import { lexer, type Token, type Tokens } from 'marked'
import { Paint } from '../output/paint.ts'
import type { Atom } from './atom.ts'
import { DrawnCode } from './drawn-code.ts'
import { InlineMarkdown } from './inline-markdown.ts'
import { WrappedLines } from './wrapped-lines.ts'

// A line of prose wider than this is hard to read, however wide the terminal is.
const TEXT_WIDTH = 100
const NARROWEST = 20
const BAR = '│'
const CALLOUT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/
const BULLET = '•'
const INDENT = '  '

// A document in Markdown as a person reads it at a terminal. The document is read by a parser of Markdown; what is
// here is only how each thing it finds is drawn: the marks are no longer shown, prose is folded to the width of a
// page, code is set apart and coloured by its language.
export class TerminalMarkdown {
  // The width prose is folded to.
  readonly width: number
  private readonly paint: Paint
  private readonly inline: InlineMarkdown
  private readonly code: DrawnCode
  private readonly wrapped: WrappedLines
  private readonly edge: number

  // `edge` is the width of the terminal. Prose is folded on a page no wider than reads well; code, whose lines are
  // as long as they are, runs to the edge.
  constructor(paint: Paint, edge: number, page = Math.min(edge, TEXT_WIDTH)) {
    this.paint = paint
    this.inline = new InlineMarkdown(paint)
    this.edge = Math.max(NARROWEST, edge)
    this.width = Math.max(NARROWEST, page)
    this.code = new DrawnCode(paint, this.edge)
    this.wrapped = new WrappedLines(this.width)
  }

  lines(markdown: string): string[] {
    return this.blocks(lexer(markdown), INDENT)
  }

  // One blank line sets two blocks apart, however many the document leaves, and none starts or ends it.
  private blocks(tokens: readonly Token[], listIndent: string): string[] {
    const drawn: string[] = []

    for (const token of tokens) {
      if (token.type !== 'space') drawn.push(...this.block(token, listIndent))
      else if (drawn.length > 0 && drawn.at(-1) !== '') drawn.push('')
    }

    while (drawn.at(-1) === '') drawn.pop()

    return drawn
  }

  private block(token: Token, listIndent: string): string[] {
    if (token.type === 'heading') return this.heading(token as Tokens.Heading)
    if (token.type === 'code') return this.fenced(token as Tokens.Code)
    if (token.type === 'list') return this.list(token as Tokens.List, listIndent)
    if (token.type === 'blockquote') return this.quote(token as Tokens.Blockquote)
    if (token.type === 'table') return this.table(token as Tokens.Table)
    if (token.type === 'hr') return [this.paint.dim('─'.repeat(Math.min(this.width, 40)))]
    if (token.type === 'paragraph' || token.type === 'text') return this.wrapped.of(this.atomsOf(token))

    // What has no drawing of its own, such as a piece of HTML, is given as it is written.
    return token.raw.trimEnd().split('\n')
  }

  // The title of the document is underlined. A heading under it opens a part of the page: a rule runs from it to
  // the edge. The headings below are only strong.
  private heading(heading: Tokens.Heading): string[] {
    const atoms = this.inline.atoms(heading.tokens, (word) => this.paint.bold(word))
    const lines = this.wrapped.of(atoms)
    const read = atoms.reduce((sum, atom) => sum + atom.width + 1, -1)
    const [only = ''] = lines

    if (heading.depth === 1) return [...lines, this.paint.dim('─'.repeat(Math.max(1, Math.min(this.width, read))))]
    if (heading.depth > 2 || lines.length > 1 || read + 2 >= this.width) return lines

    return [`${only} ${this.paint.dim('─'.repeat(this.width - read - 1))}`]
  }

  // A quote that opens with `[!NOTE]` is a callout, as GitHub draws them: its kind is its title.
  private quote(quote: Tokens.Blockquote): string[] {
    const [mark = '', kind] = CALLOUT.exec(quote.text) ?? []
    const bar = `${INDENT}${this.paint.dim(BAR)} `

    if (kind === undefined) return this.under(bar, quote.tokens)

    const title = `${kind.charAt(0)}${kind.slice(1).toLowerCase()}`
    const loud = kind === 'WARNING' || kind === 'CAUTION'

    return [`${bar}${loud ? this.paint.yellow(title) : this.paint.bold(title)}`, ...this.under(bar, lexer(quote.text.slice(mark.length)))]
  }

  private fenced(code: Tokens.Code): string[] {
    return this.code.block(code.text, code.lang ?? '')
  }

  private list(list: Tokens.List, indent: string): string[] {
    const first = typeof list.start === 'number' ? list.start : 1

    return list.items.flatMap((item, index) => {
      const mark = list.ordered ? `${String(first + index)}.` : BULLET

      return this.item(item, `${indent}${this.paint.dim(mark)} `, ' '.repeat(indent.length + mark.length + 1))
    })
  }

  // The text of an item starts after its mark and stays under its first word; what follows it in the item is drawn
  // under that word too.
  private item(item: Tokens.ListItem, first: string, rest: string): string[] {
    const [head, ...others] = item.tokens
    const text = head !== undefined && (head.type === 'text' || head.type === 'paragraph')

    return [...this.wrapped.of(text ? this.atomsOf(head) : [], first, rest), ...this.under(rest, text ? others : item.tokens, '')]
  }

  // Blocks drawn on a narrower page, each of their lines after a prefix: what a quote or an item holds.
  private under(prefix: string, tokens: readonly Token[], listIndent = INDENT): string[] {
    const taken = this.wrapped.visible(prefix)
    const narrower = new TerminalMarkdown(this.paint, this.edge - taken, this.width - taken)

    return narrower.blocks(tokens, listIndent).map((line) => `${prefix}${line}`.trimEnd())
  }

  // The cells of a table are read plain, so that its columns stand under one another.
  private table(table: Tokens.Table): string[] {
    const plain = new InlineMarkdown(new Paint(false))
    const read = (cell: Tokens.TableCell): string =>
      plain
        .atoms(cell.tokens)
        .map((atom) => atom.text)
        .join(' ')
    const rows = [table.header.map(read), ...table.rows.map((row) => row.map(read))]
    const widths = table.header.map((_, column) => Math.max(...rows.map((row) => (row[column] ?? '').length)))
    const [headings = '', ...others] = rows.map((row) =>
      `${INDENT}${row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join(INDENT)}`.trimEnd(),
    )

    return [this.paint.dim(headings), ...others]
  }

  private atomsOf(token: Token): Atom[] {
    const { tokens } = token as Tokens.Paragraph

    return this.inline.atoms(Array.isArray(tokens) ? tokens : [token])
  }
}
