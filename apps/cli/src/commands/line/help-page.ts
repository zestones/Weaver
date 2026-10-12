import type { Screen } from '../../output/screen.ts'
import type { Command, CommandGroup } from './command.ts'

const GROUPS: readonly CommandGroup[] = ['Set up', 'Supervision', 'Cards']
const FLAGS: readonly (readonly [string, string])[] = [
  ['--help', 'Show how a command is used'],
  ['--version', 'Show the version of Weaver'],
  ['--no-color', 'Print without colour'],
]
const EXAMPLES = ['weaver install claude', 'weaver doctor', 'weaver cards', 'weaver close 12 fixed "handled in the last task"']
const MANUAL = 'https://github.com/zestones/Weaver'

// The help of the command line, laid out as the help of a command usually is: what it is, how it is typed, then the
// commands by what they are for, the flags, examples, and where to read more.
export class HelpPage {
  private readonly commands: readonly Command[]
  private readonly screen: Screen

  constructor(commands: readonly Command[], screen: Screen) {
    this.commands = commands
    this.screen = screen
  }

  whole(): void {
    this.screen.line('Weaver supervises the coding agents that work in a project: it refuses, warns, checks and reviews,')
    this.screen.line('and keeps what they discover for you.')
    this.section('Usage', ['weaver <command> [arguments]'])

    const names: readonly (readonly [string, string])[] = this.commands.map((command) => [command.name, command.summary])
    const width = this.widthOf([...names, ...FLAGS])

    for (const group of GROUPS) {
      const listed = this.commands.filter((command) => command.help.group === group)

      this.listed(
        group,
        listed.map((command) => [command.name, command.summary]),
        width,
      )
    }

    this.listed('Flags', FLAGS, width)
    this.section(
      'Examples',
      EXAMPLES.map((example) => `$ ${example}`),
    )
    this.section('Learn more', [
      `Run ${this.screen.command('weaver help <command>')} for how one command is used.`,
      `Read the manual at ${MANUAL}`,
    ])
  }

  of(command: Command): void {
    const { description, words, examples } = command.help
    const flags = words.filter(([word]) => word.startsWith('--'))

    this.screen.line(description)
    this.section('Usage', [`weaver ${command.usage}`])
    this.listed(
      'Arguments',
      words.filter((word) => !flags.includes(word)),
    )
    this.listed('Flags', flags)
    this.section(
      'Examples',
      examples.map((example) => `$ ${example}`),
    )

    if (command.ownerOnly) {
      this.screen.line()
      this.screen.hint('This command decides or changes something: it is yours, and does not run under an agent.')
    }
  }

  private section(title: string, lines: readonly string[]): void {
    if (lines.length === 0) return

    this.screen.heading(title.toUpperCase())
    for (const line of lines) this.screen.line(`  ${line}`)
  }

  // Names on the left, each with what it is, the names of a page all as wide: nothing is said of an empty list.
  private listed(title: string, rows: readonly (readonly [string, string])[], width = this.widthOf(rows)): void {
    this.section(
      title,
      rows.map(([name, text]) => `${name.padEnd(width)}  ${text}`),
    )
  }

  private widthOf(rows: readonly (readonly [string, string])[]): number {
    return Math.max(0, ...rows.map(([name]) => name.length))
  }
}
