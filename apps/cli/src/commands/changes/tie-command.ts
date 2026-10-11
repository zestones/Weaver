import { CardChange, type RegistryChange } from './card-change.ts'

export class TieCommand extends CardChange {
  override readonly name = 'cards tie'
  override readonly usage = 'cards tie <a> <b> [note]'
  override readonly summary = 'Tie two cards that may be about the same thing: they stay two cards.'
  protected override readonly cards = 2

  protected override change([a = 0, b = 0]: readonly number[], words: readonly string[]): RegistryChange {
    return (registry) => {
      registry.tie(a, b, words.length === 0 ? null : words.join(' '))

      return `Cards #${String(a)} and #${String(b)} are tied.`
    }
  }
}
