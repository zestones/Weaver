import { CardChange, type RegistryChange } from './card-change.ts'

export class RestoreCommand extends CardChange {
  override readonly name = 'cards restore'
  override readonly usage = 'cards restore <number> <revision> [reason]'
  override readonly summary = 'Restore a saved content revision'
  override readonly help = {
    group: 'Cards',
    description: 'Restore title, labels and sections; keep the current version in history.',
    words: [
      ['<number>', 'Card number'],
      ['<revision>', 'Content revision shown by cards revisions'],
      ['[reason]', 'Why it is restored'],
    ],
    examples: ['weaver cards restore 12 2 "Restore the original evidence"'],
  } as const

  protected override change([number = 0]: readonly number[], [revision = '', ...reason]: readonly string[]): RegistryChange | null {
    if (!/^\d+$/.test(revision)) return null
    return (registry) => {
      registry.restore(number, Number(revision), reason.join(' ') || `Restore revision ${revision}`)
      return `Card #${String(number)} restored from revision ${revision}.`
    }
  }
}
