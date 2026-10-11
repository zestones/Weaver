import type { CardRegistry } from '@weaver/memory'
import type { Output } from '../../output/output.ts'
import { Project } from '../../project/project.ts'
import type { Command } from '../line/command.ts'

// What a command does to the registry once its words are read, giving what to say when it is done.
export type RegistryChange = (registry: CardRegistry) => string

// A command that decides on cards or corrects them. It starts with their numbers; the registry says why when the change
// cannot be made.
export abstract class CardChange implements Command {
  abstract readonly name: string
  abstract readonly usage: string
  abstract readonly summary: string
  readonly ownerOnly = true
  // How many numbers of cards the command starts with.
  protected readonly cards: number = 1
  private readonly cwd: string
  private readonly output: Output

  constructor(cwd: string, output: Output) {
    this.cwd = cwd
    this.output = output
  }

  run(args: readonly string[]): number {
    const project = Project.locate(this.cwd)
    const numbers = args.slice(0, this.cards).flatMap((word) => (/^\d+$/.test(word) ? [Number(word)] : []))
    const change = numbers.length === this.cards ? this.change(numbers, args.slice(this.cards), project) : null

    if (change === null) {
      this.output.say(`weaver ${this.usage}`)

      return 2
    }

    const registry = project.registry()

    try {
      this.output.say(change(registry))
    } finally {
      registry.close()
    }

    return 0
  }

  // null when the words cannot be used: nothing is opened for them.
  protected abstract change(numbers: readonly number[], words: readonly string[], project: Project): RegistryChange | null
}
