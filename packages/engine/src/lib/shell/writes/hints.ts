import type { ShellCommand } from '../syntax/command.ts'

export interface CommandHints {
  readonly generators: readonly string[]
  readonly readers: readonly string[]
}

export const NO_HINTS: CommandHints = { generators: [], readers: [] }

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

// A generator is named by words that appear in this order among its arguments: `make -C api contract` runs
// `make contract`. Charging a command with too much is the safe side.
export const isGenerator = (command: ShellCommand, hints: CommandHints): boolean =>
  hints.generators.map(wordsOf).some(([program, ...words]) => command.program === program && inOrder(command.args, words))

// A reader is named by the exact start of its command: a word slipped in before, such as another make target, may write.
export const isReader = (command: ShellCommand, hints: CommandHints): boolean =>
  hints.readers
    .map(wordsOf)
    .some(([program, ...words]) => command.program === program && words.every((word, index) => command.args[index] === word))
