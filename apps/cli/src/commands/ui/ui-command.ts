import { basename } from 'node:path'
import { CardDesk } from '../../cards/card-desk.ts'
import type { Output } from '../../output/output.ts'
import { Screen } from '../../output/screen.ts'
import { Project } from '../../project/project.ts'
import type { Command } from '../line/command.ts'

export class UiCommand implements Command {
  readonly name = 'ui'
  readonly usage = 'ui'
  readonly summary = 'Go through the cards on one screen'
  readonly help = {
    group: 'Cards',
    description:
      'Go through the cards on one screen: the list, narrowed and put in order as you like, the card you are on, and a key to write on it, to change its labels or to close it. It does what the commands do, and nothing they cannot.',
    words: [],
    examples: ['weaver ui'],
  } as const
  // It closes cards and changes them.
  readonly ownerOnly = true
  private readonly cwd: string
  private readonly output: Output
  private readonly screen: Screen

  constructor(cwd: string, output: Output) {
    this.cwd = cwd
    this.output = output
    this.screen = new Screen(output)
  }

  async run(args: readonly string[]): Promise<number> {
    if (args.length > 0) {
      this.screen.misuse(this.name, this.usage)

      return 2
    }

    if (this.output.width === null) {
      this.screen.error('weaver ui draws a screen: it needs a terminal. weaver cards lists the cards for a program.')

      return 1
    }

    const project = Project.locate(this.cwd)
    const registry = project.recordedRegistry()

    if (registry === null) {
      this.screen.line('Nothing waits for you.')

      return 0
    }

    try {
      // Ink and React are loaded here, to draw the screen: no other command pays for them.
      const { Interface } = await import('../../ui/start/interface.tsx')

      await new Interface(new CardDesk(project, registry), basename(project.top)).run()

      return 0
    } finally {
      registry.close()
    }
  }
}
