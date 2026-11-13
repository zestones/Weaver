import { Card } from '@weaver/memory'
import { CardDesk } from '../../cards/card-desk.ts'
import type { Project } from '../../project/project.ts'
import { CardChange, type RegistryChange } from './card-change.ts'
import type { Caller } from '../../caller/caller.ts'
import { ProcessCaller } from '../../caller/process-caller.ts'
import type { Output } from '../../output/output.ts'
import { CloseProposals } from './close-proposals.ts'

const CLOSINGS = Card.CLOSINGS

export class CloseCommand extends CardChange {
  override readonly ownerOnly = true
  override readonly name = 'close'
  override readonly usage = `close <number> [${CLOSINGS.join('|')}] [reason] | close --proposed [--yes]`
  override readonly summary = 'Close a card'
  override readonly help = {
    group: 'Cards',
    description: 'Close a card: it was fixed, it will not be, it is now an issue of its own, or what it says proved not to be true.',
    words: [
      ['<number>', 'The number of the card, as weaver cards shows it'],
      [CLOSINGS.join('|'), 'Why it closes: it was fixed, it will not be, it becomes an issue of its own, or what it says is not true'],
      ['[reason]', 'A few words kept with the card'],
      ['--proposed', 'List and accept all closing proposals after one terminal confirmation'],
      ['--yes', 'Accept the listed proposals without confirmation; required without a terminal'],
    ],
    examples: [
      'weaver close 12 fixed',
      'weaver close 12 wontfix "the old behaviour is wanted"',
      'weaver close 12 invalid',
      'weaver close --proposed',
    ],
  } as const
  private readonly proposals: CloseProposals

  constructor(cwd: string, output: Output, caller: Caller = new ProcessCaller()) {
    super(cwd, output, caller)
    this.proposals = new CloseProposals(cwd, output, caller)
  }

  override run(args: readonly string[]): number {
    return args.includes('--proposed') ? this.proposals.run(args) : super.run(args)
  }

  protected override change([number = 0]: readonly number[], [as, ...words]: readonly string[], project: Project): RegistryChange | null {
    const closing = CLOSINGS.find((known) => known === as)

    if (as !== undefined && closing === undefined) return null

    return (registry) => new CardDesk(project, registry).close(number, closing ?? null, words.length === 0 ? null : words.join(' '))
  }
}
