import { CardChange, type RegistryChange } from './card-change.ts'

export class RetitleCommand extends CardChange {
  override readonly name = 'cards retitle'
  override readonly usage = 'cards retitle <number> <title>'
  override readonly summary = 'Correct the title of a card'
  override readonly help = {
    group: 'Cards',
    description: 'Correct the title of a card.',
    words: [
      ['<number>', 'The number of the card, as weaver cards shows it'],
      ['<title>', 'The title the card takes'],
    ],
    examples: ['weaver cards retitle 12 "The token is never refreshed"'],
  } as const

  protected override change([number = 0]: readonly number[], words: readonly string[]): RegistryChange | null {
    const title = words.join(' ').trim()

    return title === '' ? null : (registry) => `Card #${String(number)} is now titled: ${registry.correct(number, { title }).title}`
  }
}
