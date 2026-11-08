import type { Caller } from '../../caller/caller.ts'
import { ProcessCaller } from '../../caller/process-caller.ts'
import { CardActor } from '../../caller/card-actor.ts'
import type { CardRegistry } from '@weaver/memory'
import type { Output } from '../../output/output.ts'
import { Screen } from '../../output/screen.ts'
import { Project } from '../../project/project.ts'
import type { Command, CommandHelp } from '../line/command.ts'

// What a command does to the registry once its words are read, giving what to say when it is done.
export type RegistryChange = (registry: CardRegistry) => string

// A command that decides on cards or corrects them. It starts with their numbers; the registry says why when the change
// cannot be made.
export abstract class CardChange implements Command {
  abstract readonly name: string
  abstract readonly usage: string
  abstract readonly summary: string
  abstract readonly help: CommandHelp
  readonly ownerOnly: boolean = false
  // How many numbers of cards the command starts with.
  protected readonly cards: number = 1
  private readonly caller: Caller
  private readonly cwd: string
  private readonly screen: Screen

  constructor(cwd: string, output: Output, caller: Caller = new ProcessCaller()) {
    this.caller = caller
    this.cwd = cwd
    this.screen = new Screen(output)
  }

  run(args: readonly string[]): number {
    const project = Project.locate(this.cwd)
    const numbers = args.slice(0, this.cards).flatMap((word) => (/^\d+$/.test(word) ? [Number(word)] : []))
    const change = numbers.length === this.cards ? this.change(numbers, args.slice(this.cards), project) : null

    if (change === null) {
      this.screen.misuse(this.name, this.usage)

      return 2
    }

    const registry = project.registry(new CardActor(this.caller).provenance())

    try {
      registry.claimCommand([...this.name.split(' '), ...args])
      this.screen.done(change(registry))
    } finally {
      registry.close()
    }

    return 0
  }

  // null when the words cannot be used: nothing is opened for them.
  protected abstract change(numbers: readonly number[], words: readonly string[], project: Project): RegistryChange | null
}
