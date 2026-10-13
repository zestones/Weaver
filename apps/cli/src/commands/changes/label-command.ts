import { DeclarationParts } from '@weaver/engine'
import { CardDesk } from '../../cards/card-desk.ts'
import type { Project } from '../../project/project.ts'
import { CardChange, type RegistryChange } from './card-change.ts'

type Label = readonly [family: string, value: string]

const SET = '--set'

export class LabelCommand extends CardChange {
  override readonly name = 'cards label'
  override readonly usage = 'cards label <number> [--set] <family:value>...'
  override readonly summary = 'Replace the labels of a card'
  override readonly help = {
    group: 'Cards',
    description: 'Replace the labels of a card, with labels the project declares: all of them, or those of the families named only.',
    words: [
      ['<number>', 'The number of the card, as weaver cards shows it'],
      ['--set', 'Replace the labels of the families named, and keep the others as they are'],
      ['<family:value>...', 'The labels the card keeps, among those the project declares'],
    ],
    examples: ['weaver cards label 12 type:bug area:auth', 'weaver cards label 12 --set level:high'],
  } as const

  protected override change(
    [number = 0]: readonly number[],
    [first = '', ...rest]: readonly string[],
    project: Project,
  ): RegistryChange | null {
    const some = first === SET
    const words = some ? rest : [first, ...rest]
    const given = words.flatMap((word): Label[] => {
      const [family = '', value = '', ...more] = word.split(':')

      return family === '' || value === '' || more.length > 0 ? [] : [[family, value]]
    })

    if (given.length === 0 || given.length < words.length) return null

    const labels = this.declared(given, project)

    return (registry) => {
      const card = some ? new CardDesk(project, registry).relabel(number, labels) : registry.correct(number, { labels })

      return `Card #${String(number)} is now labelled ${card.labels().join(', ')}.`
    }
  }

  // A label the project does not have would only be refused later, where its issues live.
  private declared(given: readonly Label[], project: Project): Record<string, string[]> {
    const catalogue = project.declaration()?.labels ?? {}
    const unknown = given.filter(([family, value]) => !Object.hasOwn(catalogue, family) || !Object.hasOwn(catalogue[family] ?? {}, value))
    const families = new Map<string, string[]>()

    if (unknown.length > 0) {
      throw new Error(
        `${unknown.map((label) => label.join(':')).join(', ')}: ${unknown.length === 1 ? 'not a label' : 'not labels'} of this project, which declares its labels in ${project.configName}/${DeclarationParts.FILES.labels}`,
      )
    }

    for (const [family, value] of given) families.set(family, [...new Set([...(families.get(family) ?? []), value])])

    return Object.fromEntries(families)
  }
}
