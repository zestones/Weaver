import { CardChange, type RegistryChange } from './card-change.ts'

export class RevisionsCommand extends CardChange {
  override readonly name = 'cards revisions'
  override readonly usage = 'cards revisions <number>'
  override readonly summary = 'Inspect saved content revisions'
  override readonly help = {
    group: 'Cards',
    description: 'Show each immutable before and after version, actor and reason.',
    words: [['<number>', 'Card number']],
    examples: ['weaver cards revisions 12'],
  } as const

  protected override change([number = 0]: readonly number[], words: readonly string[]): RegistryChange | null {
    if (words.length > 0) return null
    return (registry) => {
      const card = registry.find(number)
      if (card === null) throw new Error('card does not exist')
      return JSON.stringify(card.record.revisions ?? [], null, 2)
    }
  }
}
