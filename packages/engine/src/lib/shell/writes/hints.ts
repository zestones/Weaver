import type { ShellCommand } from '../syntax/command.ts'

export interface ScriptHints {
  readonly writers: readonly string[]
  readonly readers: readonly string[]
}

export const NO_HINTS: ScriptHints = { writers: [], readers: [] }

const wordsOf = (entry: string): string[] => entry.trim().split(/\s+/)

function inOrder(args: readonly string[], words: readonly string[]): boolean {
  let from = 0

  for (const word of words) {
    const found = args.indexOf(word, from)

    if (found === -1) return false

    from = found + 1
  }

  return true
}

// A command is named by words that appear in this order among its arguments: `make -C api contract` runs
// `make contract`. Taking a command for the one named too often is the safe side.
export function runsAs(command: ShellCommand, entry: string): boolean {
  const [program, ...words] = wordsOf(entry)

  return command.program === program && inOrder(command.args, words)
}

export const isWriter = (command: ShellCommand, hints: ScriptHints): boolean => hints.writers.some((entry) => runsAs(command, entry))

// A reader is named by the exact start of its command: a word slipped in before, such as another make target, may write.
export const isReader = (command: ShellCommand, hints: ScriptHints): boolean =>
  hints.readers
    .map(wordsOf)
    .some(([program, ...words]) => command.program === program && words.every((word, index) => command.args[index] === word))
