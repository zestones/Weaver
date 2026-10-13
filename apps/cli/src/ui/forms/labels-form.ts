import { LabelFamilies, type Card, type LabelCatalog } from '@weaver/memory'
import type { Key } from 'ink'
import type { Form } from './form.ts'

type Chosen = Readonly<Record<string, readonly string[]>>

interface Fields {
  readonly chosen: Chosen
  readonly column: number
  readonly row: number
  readonly outcome: Form['outcome']
  readonly problem: string | null
}

// The labels of a card, a family of the project in each column. A card has one level and one type, and as many
// values as fit in the other families.
export class LabelsForm implements Form {
  readonly card: Card
  readonly catalog: LabelCatalog
  readonly chosen: Chosen
  readonly column: number
  readonly row: number
  readonly outcome: Form['outcome']
  readonly problem: string | null

  private constructor(card: Card, catalog: LabelCatalog, fields: Fields) {
    this.card = card
    this.catalog = catalog
    this.chosen = fields.chosen
    this.column = fields.column
    this.row = fields.row
    this.outcome = fields.outcome
    this.problem = fields.problem
  }

  static for(card: Card, catalog: LabelCatalog): LabelsForm {
    const chosen = Object.fromEntries(Object.keys(catalog).map((family) => [family, card.valuesOf(family)]))

    return new LabelsForm(card, catalog, { chosen, column: 0, row: 0, outcome: 'open', problem: null })
  }

  get families(): readonly string[] {
    return new LabelFamilies(Object.keys(this.catalog)).ordered
  }

  // Whether a card has one value of this family at most.
  takesOne(family: string): boolean {
    return new LabelFamilies(Object.keys(this.catalog)).takesOne(family)
  }

  valuesOf(family: string): readonly string[] {
    return Object.keys(this.catalog[family] ?? {})
  }

  // The family and the value the keys are on; null in a project that declares no label.
  get focused(): { readonly family: string; readonly value: string; readonly meaning: string } | null {
    const family = this.families[this.column]
    const value = family === undefined ? undefined : this.valuesOf(family)[this.row]

    return family === undefined || value === undefined ? null : { family, value, meaning: this.catalog[family]?.[value] ?? '' }
  }

  pressed(input: string, key: Key): LabelsForm {
    const focused = this.focused

    if (key.escape) return this.with({ outcome: 'cancelled' })
    if (key.return) return this.with({ outcome: 'submitted' })
    if (focused === null) return this
    if (key.leftArrow || key.rightArrow) {
      const column = Math.min(this.families.length - 1, Math.max(0, this.column + (key.rightArrow ? 1 : -1)))
      const rows = this.valuesOf(this.families[column] ?? '').length

      return this.with({ column, row: Math.min(this.row, Math.max(0, rows - 1)) })
    }
    if (key.upArrow) return this.with({ row: Math.max(0, this.row - 1) })
    if (key.downArrow) return this.with({ row: Math.min(this.valuesOf(focused.family).length - 1, this.row + 1) })
    if (input === ' ') return this.with({ chosen: { ...this.chosen, [focused.family]: this.toggled(focused.family, focused.value) } })

    return this
  }

  refused(problem: string): LabelsForm {
    return this.with({ outcome: 'open', problem })
  }

  private toggled(family: string, value: string): readonly string[] {
    const held = this.chosen[family] ?? []

    if (held.includes(value)) return held.filter((other) => other !== value)

    return this.takesOne(family) ? [value] : this.valuesOf(family).filter((other) => other === value || held.includes(other))
  }

  private with(change: Partial<Fields>): LabelsForm {
    const { chosen, column, row, outcome, problem } = this

    return new LabelsForm(this.card, this.catalog, { chosen, column, row, outcome, problem, ...change })
  }
}
