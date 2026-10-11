import { FlagRecorder } from '@weaver/engine'
import { FlagText } from '@weaver/memory'
import type { Caller } from '../../caller/caller.ts'
import type { Input } from '../../input/input.ts'
import type { Output } from '../../output/output.ts'
import { Project } from '../../project/project.ts'
import type { Command } from '../line/command.ts'

const OWNER = 'owner'

export class FlagCommand implements Command {
  readonly name = 'flag'
  readonly usage = 'flag <place>...'
  readonly summary = 'Flag something you found, for later: where it is, and the five fields read on the standard input.'
  // An agent flags too, and is answered in its own words below.
  readonly ownerOnly = false
  private readonly cwd: string
  private readonly output: Output
  private readonly input: Input
  private readonly caller: Caller

  constructor(cwd: string, output: Output, input: Input, caller: Caller) {
    this.cwd = cwd
    this.output = output
    this.input = input
    this.caller = caller
  }

  run(args: readonly string[]): number {
    const agent = this.caller.agent()

    // The hook knows the session and the unit of work a flag comes from. This command would record it without them.
    if (agent !== null) {
      this.output.say(
        `Nothing was recorded. The flag of an agent is recorded by Weaver's hook, which answers in place of this command: reading this means that the project is not wired for ${agent}. weaver doctor says what is missing.`,
      )

      return 1
    }

    const project = Project.locate(this.cwd)
    const body = this.input.read()
    const registry = project.registry()

    try {
      const { card, problems } = new FlagRecorder(project.repository, registry).record(
        { callId: null, places: args, body, cwd: this.cwd },
        { author: OWNER, role: OWNER, session: null, subagent: null, unit: null, requests: [] },
      )

      if (card !== null) {
        this.output.say(`Flag #${String(card.number)} recorded.`)

        return 0
      }

      this.output.say('The flag was not recorded:')
      for (const problem of problems) this.output.say(`  ${problem}`)
      this.output.say('')
      this.output.say(FlagText.FORMAT)

      return 1
    } finally {
      registry.close()
    }
  }
}
