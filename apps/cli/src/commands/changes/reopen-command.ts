import { CardChange, type RegistryChange } from './card-change.ts'

export class ReopenCommand extends CardChange {
  override readonly name = 'cards reopen'
  override readonly usage = 'cards reopen <number> [note]'
  override readonly summary = 'Open a closed card again'
  override readonly help = {
    group: 'Cards',
    description: 'Open a closed card again: it waits for you as before.',
    words: [
      ['<number>', 'The number of the card, as weaver cards shows it'],
      ['[note]', 'A few words kept with the card'],
    ],
    examples: ['weaver cards reopen 12 "it came back"'],
  } as const

  protected override change([number = 0]: readonly number[], words: readonly string[]): RegistryChange {
    return (registry) => {
      registry.reopen(number, words.length === 0 ? null : words.join(' '))

      return `Card #${String(number)} waits for you again.`
    }
  }
}
