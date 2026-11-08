import { CardChange, type RegistryChange } from './card-change.ts'

export class IssueResultCommand extends CardChange {
  override readonly name = 'cards issue-result'
  override readonly usage = 'cards issue-result <number> <url|not-filed>'
  override readonly summary = 'Reconcile an interrupted issue filing'
  override readonly help = {
    group: 'Cards',
    description:
      'After checking the issue tracker, record the existing issue URL or confirm nothing was filed. Closing remains the owner’s.',
    words: [
      ['<number>', 'Card number'],
      ['<url|not-filed>', 'Existing issue URL, or confirmation that no issue was created'],
    ],
    examples: ['weaver cards issue-result 12 https://github.com/org/repo/issues/48'],
  } as const

  protected override change([number = 0]: readonly number[], words: readonly string[]): RegistryChange | null {
    const [result = ''] = words
    if (words.length !== 1 || (result !== 'not-filed' && !/^https?:\/\//.test(result))) return null
    return (registry) => {
      registry.reconcileIssue(number, result)
      return `Issue filing for card #${String(number)} reconciled: ${result}.`
    }
  }
}
