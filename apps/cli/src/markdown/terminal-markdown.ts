import { lexer, type Token, type Tokens } from 'marked'
import { Paint } from '../output/paint.ts'
import type { Atom } from './atom.ts'
import { CodeColours } from './code-colours.ts'
import { InlineMarkdown } from './inline-markdown.ts'
import { WrappedLines } from './wrapped-lines.ts'

// A line of prose wider than this is hard to read, however wide the terminal is.
const TEXT_WIDTH = 100
const NARROWEST = 20
// An item that names something and says what it is, as the head of a card does: `State: open`.
const NAMED = /^([A-Z][^:`*\n]{0,30}):(?:[ \t]+\S[^]*)?$/
const BAR = '│'
const BULLET = '•'
const INDENT = '  '

// A document in Markdown as a person reads it at a terminal. The document is read by a parser of Markdown; what is
// here is only how each thing it finds is drawn: the marks are no longer shown, prose is folded to the width of a
// page, the items that name things are lined up, code is set apart and coloured by its language.
export class TerminalMarkdown {
  private readonly paint: Paint
  private readonly inline: InlineMarkdown
  private readonly code: CodeColours
  private readonly wrapped: WrappedLines
  private readonly width: number

  constructor(paint: Paint, width: number) {
    this.paint = paint
    this.inline = new InlineMarkdown(paint)
    this.code = new CodeColours(paint)
    this.width = Math.max(NARROWEST, Math.min(width, TEXT_WIDTH))
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
    if (token.type === 'blockquote') return this.under(`${INDENT}${this.paint.dim(BAR)} `, (token as Tokens.Blockquote).tokens)
    if (token.type === 'table') return this.table(token as Tokens.Table)
    if (token.type === 'hr') return [this.paint.dim('─'.repeat(Math.min(this.width, 40)))]
    if (token.type === 'paragraph' || token.type === 'text') return this.wrapped.of(this.atomsOf(token))

    // What has no drawing of its own, such as a piece of HTML, is given as it is written.
    return token.raw.trimEnd().split('\n')
  }

  // The title of the document is underlined; the headings under it are only strong.
  private heading(heading: Tokens.Heading): string[] {
    const atoms = this.inline.atoms(heading.tokens, (word) => this.paint.bold(word))
    const lines = this.wrapped.of(atoms)
    const read = atoms.reduce((sum, atom) => sum + atom.width + 1, -1)

    return heading.depth === 1 ? [...lines, this.paint.dim('─'.repeat(Math.max(1, Math.min(this.width, read))))] : lines
  }

  // Code is not folded: where a line of it breaks means something.
  private fenced(code: Tokens.Code): string[] {
    return this.code.lines(code.text, code.lang ?? '').map((line) => `${INDENT}${this.paint.dim(BAR)} ${line}`)
  }

  private list(list: Tokens.List, indent: string): string[] {
    const names = list.ordered ? [] : list.items.map((item) => this.nameOf(item))
    const lined = names.length > 1 && names.every((name) => name !== null)
    const nameWidth = Math.max(0, ...names.map((name) => name?.length ?? 0))
    const first = typeof list.start === 'number' ? list.start : 1

    return list.items.flatMap((item, index) => {
      const name = names[index] ?? null

      if (lined && name !== null) return this.named(item, name, nameWidth)

      const mark = list.ordered ? `${String(first + index)}.` : BULLET

      return this.item(item, `${indent}${this.paint.dim(mark)} `, ' '.repeat(indent.length + mark.length + 1))
    })
  }

  // The first words of an item, when they name what the item is about; null when the item is a sentence.
  private nameOf(item: Tokens.ListItem): string | null {
    const [first] = item.tokens

    return first?.type === 'text' ? (NAMED.exec(first.raw.trimEnd())?.[1] ?? null) : null
  }

  // A name and what it is, the names of a list all as wide: what is said starts in one column. What is set under the
  // item, such as the requests of the owner, stays under its name.
  private named(item: Tokens.ListItem, name: string, nameWidth: number): string[] {
    const [first, ...others] = item.tokens
    const value = first === undefined ? [] : this.atomsOf(first).slice(name.split(/\s+/).length)
    const label = this.paint.dim(name.padEnd(nameWidth))
    const said =
      value.length === 0 ? [this.paint.dim(name)] : this.wrapped.of(value, `${label}${INDENT}`, ' '.repeat(nameWidth + INDENT.length))

    return [...said, ...this.under(INDENT, others, '')]
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
    const narrower = new TerminalMarkdown(this.paint, this.width - this.wrapped.visible(prefix))

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
