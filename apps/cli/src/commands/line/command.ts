// The part of the help a command is listed in.
export type CommandGroup = 'Set up' | 'Supervision' | 'Cards'

// What `weaver help <command>` says of a command, beyond how it is typed.
export interface CommandHelp {
  readonly group: CommandGroup
  readonly description: string
  // The words of the usage line that need saying, each with what it is. A word that starts with `--` is a flag.
  readonly words: readonly (readonly [string, string])[]
  readonly examples: readonly string[]
}

export interface Command {
  // The words that call it: one, or two as in `cards reopen`.
  readonly name: string
  readonly usage: string
  // What it does in a few words, as the list of the commands shows it.
  readonly summary: string
  // It decides or changes something: it is the owner's, and does not run under an agent.
  readonly ownerOnly: boolean
  readonly help: CommandHelp

  // The exit status of the process. A command that asks something of another process answers later.
  run(args: readonly string[]): number | Promise<number>
}
