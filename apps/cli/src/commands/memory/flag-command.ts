import { FlagRecorder } from '@weaver/engine'
import { FlagText } from '@weaver/memory'
import type { Caller } from '../../caller/caller.ts'
import type { Input } from '../../input/input.ts'
import type { Output } from '../../output/output.ts'
import { Screen } from '../../output/screen.ts'
import { Project } from '../../project/project.ts'
import type { Command } from '../line/command.ts'

const OWNER = 'owner'

export class FlagCommand implements Command {
  readonly name = 'flag'
  readonly usage = 'flag <place>...'
  readonly summary = 'Flag something you found, for later'
  readonly help = {
    group: 'Cards',
    description: 'Flag something you found, for later: where it is, and the five fields read on the standard input.',
    words: [['<place>...', 'Where it is: a file, or a file and a line as src/auth/token.ts:42']],
    examples: ['weaver flag src/auth/token.ts:42 < flag.md'],
  } as const
  // An agent flags too, and is answered in its own words below.
  readonly ownerOnly = false
  private readonly cwd: string
  private readonly screen: Screen
  private readonly input: Input
  private readonly caller: Caller

  constructor(cwd: string, output: Output, input: Input, caller: Caller) {
    this.cwd = cwd
    this.screen = new Screen(output)
    this.input = input
    this.caller = caller
  }

  run(args: readonly string[]): number {
    const agent = this.caller.agent()

    // The hook knows the session and the unit of work a flag comes from. This command would record it without them.
    if (agent !== null) {
      this.screen.error(
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
        this.screen.done(`Flag #${String(card.number)} recorded.`)

        return 0
      }

      this.screen.error('The flag was not recorded:', ...problems)
      this.screen.aside()
      for (const line of FlagText.FORMAT.split('\n')) this.screen.aside(line)

      return 1
    } finally {
      registry.close()
    }
  }
}
