import type { Output } from './output.ts'
import type { TextTable } from './text-table.ts'

// The marks of a line that states how something stands. They are text, so that a program reading the output, or a
// person who sees no colour, reads the state all the same.
const DONE = '✓'
const PROBLEM = 'X'
const ALERT = '!'
const NEUTRAL = '-'
const INDENT = '  '

// How Weaver's commands look, in one place: a command says what it has to say, and this draws it. The conventions
// are those of the Command Line Interface Guidelines (clig.dev) and of the design guide of GitHub's command line.
export class Screen {
  private readonly output: Output
  private started = false

  constructor(output: Output) {
    this.output = output
  }

  line(text = ''): void {
    this.said(text)
  }

  // The heading of a section, set off from what comes before it.
  heading(text: string): void {
    if (this.started) this.said('')

    this.said(this.output.paint.bold(text))
  }

  done(text: string, depth = 0): void {
    this.marked(this.output.paint.green(DONE), text, depth)
  }

  problem(text: string, depth = 0): void {
    this.marked(this.output.paint.red(PROBLEM), text, depth)
  }

  alert(text: string, depth = 0): void {
    this.marked(this.output.paint.yellow(ALERT), text, depth)
  }

  note(text: string, depth = 0): void {
    this.marked(this.output.paint.dim(NEUTRAL), text, depth)
  }

  // What comes second: an explanation, or the command to run next.
  hint(text: string, depth = 0): void {
    this.said(`${INDENT.repeat(depth)}${this.output.paint.dim(text)}`)
  }

  // A table under its headings, which are only there to name the columns.
  table(table: TextTable, depth = 1): void {
    const [headings = '', ...rows] = table.lines(INDENT.repeat(depth))

    this.said(this.output.paint.dim(headings))
    for (const row of rows) this.said(row)
  }

  // Something to type, told apart from the sentence around it.
  command(text: string): string {
    return this.output.paint.cyan(text)
  }

  bold(text: string): string {
    return this.output.paint.bold(text)
  }

  dim(text: string): string {
    return this.output.paint.dim(text)
  }

  // What went wrong, with what to do about it last: it is the line the owner reads.
  error(text: string, ...hints: readonly string[]): void {
    this.output.fail(`${this.output.failPaint.red(PROBLEM)} ${text}`)
    for (const hint of hints) this.output.fail(`${INDENT}${this.output.failPaint.dim(hint)}`)
  }

  // A line beside an error that is to be read or copied as it is, such as the form a flag takes.
  aside(text = ''): void {
    this.output.fail(text)
  }

  // A command that was given words it cannot use: how it is used, and where more is said.
  misuse(name: string, usage: string, why: string | null = null): void {
    if (why !== null) this.output.fail(`${this.output.failPaint.red(PROBLEM)} ${why}`)

    this.output.fail(`Usage: weaver ${usage}`)
    this.output.fail(this.output.failPaint.dim(`Run weaver help ${name} for what each word means.`))
  }

  private marked(mark: string, text: string, depth: number): void {
    this.said(`${INDENT.repeat(depth)}${mark} ${text}`)
  }

  private said(line: string): void {
    this.started = true
    this.output.say(line)
  }
}
