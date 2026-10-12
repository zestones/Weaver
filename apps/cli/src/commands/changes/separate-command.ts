import { CardChange, type RegistryChange } from './card-change.ts'

export class SeparateCommand extends CardChange {
  override readonly name = 'cards separate'
  override readonly usage = 'cards separate <number>'
  override readonly summary = 'Undo a merge'
  override readonly help = {
    group: 'Cards',
    description: 'Undo a merge: the card is a card of its own again.',
    words: [['<number>', 'The number of the card, as weaver cards shows it']],
    examples: ['weaver cards separate 15'],
  } as const

  protected override change([number = 0]: readonly number[], words: readonly string[]): RegistryChange | null {
    if (words.length > 0) return null

    return (registry) => {
      const card = registry.separate(number)

      return `Card #${String(number)} is a card of its own again, ${card.state}.`
    }
  }
}
