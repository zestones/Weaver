import { CardChange, type RegistryChange } from './card-change.ts'

export class UntieCommand extends CardChange {
  override readonly name = 'cards untie'
  override readonly usage = 'cards untie <a> <b>'
  override readonly summary = 'Undo the tie between two cards'
  override readonly help = {
    group: 'Cards',
    description: 'Undo the tie between two cards.',
    words: [['<a> <b>', 'The numbers of the two cards']],
    examples: ['weaver cards untie 12 15'],
  } as const
  protected override readonly cards = 2

  protected override change([a = 0, b = 0]: readonly number[], words: readonly string[]): RegistryChange | null {
    if (words.length > 0) return null

    return (registry) => {
      registry.untie(a, b)

      return `Cards #${String(a)} and #${String(b)} are no longer tied.`
    }
  }
}
