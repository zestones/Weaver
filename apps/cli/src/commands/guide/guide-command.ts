import { WeaverGuide } from '@weaver/engine'
import type { Output } from '../../output/output.ts'
import { Screen } from '../../output/screen.ts'
import { Project } from '../../project/project.ts'
import type { Command } from '../line/command.ts'

// The guide Weaver gives the agents of this project, as the runtimes read it in their skill: always the one of this
// Weaver and of what the project declares now.
export class GuideCommand implements Command {
  readonly name = 'guide'
  readonly usage = 'guide'
  readonly summary = 'Show how an agent works under Weaver here'
  readonly ownerOnly = false
  readonly help = {
    group: 'Supervision',
    description:
      'Show the guide Weaver gives the agents of this project: what it does around their calls, its commands and when to use them, and what is the owner’s alone. It is written with what the project declares, and the runtimes read it as a skill.',
    words: [],
    examples: ['weaver guide'],
  } as const
  private readonly cwd: string
  private readonly screen: Screen

  constructor(cwd: string, output: Output) {
    this.cwd = cwd
    this.screen = new Screen(output)
  }

  async run(): Promise<number> {
    const declaration = Project.locate(this.cwd).declaration()

    if (declaration === null) {
      this.screen.error('No guide: this project declares nothing for Weaver.', 'Its owner puts Weaver on it with weaver install.')

      return 1
    }

    const { text } = new WeaverGuide(declaration)

    // The parser of Markdown is loaded only to draw the guide at a terminal.
    await this.screen.page(text, async (paint, width) => {
      const { TerminalMarkdown } = await import('../../markdown/terminal-markdown.ts')

      return new TerminalMarkdown(paint, width).lines(text)
    })

    return 0
  }
}
