import { NoteRecorder } from '@weaver/engine'
import { NoteText } from '@weaver/memory'
import type { Caller } from '../../caller/caller.ts'
import type { Input } from '../../input/input.ts'
import type { Output } from '../../output/output.ts'
import { Screen } from '../../output/screen.ts'
import { Project } from '../../project/project.ts'
import type { Command } from '../line/command.ts'

const OWNER = 'owner'
const CONCLUSIONS = NoteText.CONCLUSIONS.join('|')

export class NoteCommand implements Command {
  readonly name = 'note'
  readonly usage = `note <number> [${CONCLUSIONS}] [text]`
  readonly summary = 'Write on a card what you found or did'
  readonly help = {
    group: 'Cards',
    description: 'Write on a card what you found or did about it. The text is given on the line, or read on the standard input.',
    words: [
      ['<number>', 'The number of the card, as weaver cards shows it'],
      [`[${CONCLUSIONS}]`, 'What you conclude of the card: it is true, it is not, you could not tell, or it is fixed'],
      ['[text]', 'What the note says'],
    ],
    examples: ['weaver note 12 "to look at with the next release"', 'weaver note 12 confirmed < report.md'],
  } as const
  // An agent writes on a card too, and is answered in its own words below.
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

    // The hook knows the session and the unit of work a note comes from. This command would write it without them.
    if (agent !== null) {
      this.screen.error(
        `Nothing was written. The note of an agent is written by Weaver's hook, which answers in place of this command: reading this means that the project is not wired for ${agent}. weaver doctor says what is missing.`,
      )

      return 1
    }

    const project = Project.locate(this.cwd)
    const typed = new NoteText(args, null)
    // What the line does not say is read: a report is longer than a few words.
    const body = typed.card !== null && typed.text === '' ? this.input.read() : null
    const registry = project.registry()

    try {
      const { card, problems } = new NoteRecorder(project.repository, registry).record(
        { words: args, body },
        { author: OWNER, role: OWNER, session: null, subagent: null, unit: null, requests: [] },
      )

      if (card !== null) {
        this.screen.done(`Note written on card #${String(card.number)}.`)

        return 0
      }

      this.screen.error('The note was not written:', ...problems)
      this.screen.aside()
      this.screen.aside(`Usage: weaver ${this.usage}`)

      return 1
    } finally {
      registry.close()
    }
  }
}
