import { Card } from '@weaver/memory'
import { CardDesk } from '../../cards/card-desk.ts'
import type { Project } from '../../project/project.ts'
import { CardChange, type RegistryChange } from './card-change.ts'

const CLOSINGS = Card.CLOSINGS

export class CloseCommand extends CardChange {
  override readonly name = 'close'
  override readonly usage = `close <number> ${CLOSINGS.join('|')} [reason]`
  override readonly summary = 'Close a card'
  override readonly help = {
    group: 'Cards',
    description: 'Close a card: it was fixed, it will not be, it is now an issue of its own, or what it says proved not to be true.',
    words: [
      ['<number>', 'The number of the card, as weaver cards shows it'],
      [CLOSINGS.join('|'), 'Why it closes: it was fixed, it will not be, it becomes an issue of its own, or what it says is not true'],
      ['[reason]', 'A few words kept with the card'],
    ],
    examples: ['weaver close 12 fixed', 'weaver close 12 wontfix "the old behaviour is wanted"', 'weaver close 12 invalid'],
  } as const

  protected override change([number = 0]: readonly number[], [as, ...words]: readonly string[], project: Project): RegistryChange | null {
    const closing = CLOSINGS.find((known) => known === as)

    if (closing === undefined) return null

    return (registry) => new CardDesk(project, registry).close(number, closing, words.length === 0 ? null : words.join(' '))
  }
}
