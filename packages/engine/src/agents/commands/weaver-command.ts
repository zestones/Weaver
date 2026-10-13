import { basename } from 'node:path'
import type { ShellCommand } from '../../lib/shell/syntax/command.ts'

const PROGRAMS: ReadonlySet<string> = new Set(['weaver', 'weaver.js'])
const NODE = 'node'
const TABS_STRIPPED = '<<-'

// A command of a shell call that runs Weaver's own program: by its name, by a path to it, or through node.
export class WeaverCommand {
  readonly command: ShellCommand
  // What follows the program: the command of Weaver, then its arguments.
  readonly words: readonly string[]

  private constructor(command: ShellCommand, words: readonly string[]) {
    this.command = command
    this.words = words
  }

  // What the command is given to read in a heredoc; null when none follows it.
  get heredoc(): string | null {
    const heredoc = this.command.redirects.find((redirect) => redirect.heredoc !== null)
    const text = heredoc?.heredoc ?? null

    // The shell takes the leading tabs off a heredoc opened with `<<-`; the parser leaves them.
    return text !== null && heredoc?.operator === TABS_STRIPPED ? text.replace(/^\t+/gm, '') : text
  }

  static among(commands: readonly ShellCommand[]): WeaverCommand[] {
    return commands.flatMap((command) => {
      const words = WeaverCommand.wordsOf(command)

      return words === null ? [] : [new WeaverCommand(command, words)]
    })
  }

  private static wordsOf({ program, args }: ShellCommand): readonly string[] | null {
    if (PROGRAMS.has(program)) return args
    if (program !== NODE) return null

    const script = args.findIndex((arg) => !arg.startsWith('-'))

    return script !== -1 && PROGRAMS.has(basename(args[script] ?? '')) ? args.slice(script + 1) : null
  }
}
