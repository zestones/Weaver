import { LabelFamilies, type CardListing, type LabelCatalog } from '@weaver/memory'
import type { Key } from 'ink'
import type { Form } from './form.ts'

// How far back the cards of the list go.
export type Since = 'today' | 'week' | 'ever'
type Chosen = Readonly<Record<string, readonly string[]>>

interface Fields {
  readonly chosen: Chosen
  readonly since: Since
  readonly column: number
  readonly row: number
  readonly outcome: Form['outcome']
}

// Narrowing the list: the values wanted in each family of labels, and how far back the cards go.
export class FilterForm implements Form {
  static readonly SINCE: readonly Since[] = ['today', 'week', 'ever']
  static readonly SINCE_NAMES: Readonly<Record<Since, string>> = { today: 'today', week: '7 days', ever: 'ever' }

  readonly catalog: LabelCatalog
  // The cards of the view, before any narrowing: what the counts beside each value are taken from.
  readonly listing: CardListing
  readonly chosen: Chosen
  readonly since: Since
  readonly column: number
  readonly row: number
  readonly outcome: Form['outcome']
  readonly problem = null

  constructor(catalog: LabelCatalog, listing: CardListing, fields: Fields) {
    this.catalog = catalog
    this.listing = listing
    this.chosen = fields.chosen
    this.since = fields.since
    this.column = fields.column
    this.row = fields.row
    this.outcome = fields.outcome
  }

  static for(catalog: LabelCatalog, listing: CardListing, chosen: Chosen, since: Since): FilterForm {
    return new FilterForm(catalog, listing, { chosen, since, column: 0, row: 0, outcome: 'open' })
  }

  get families(): readonly string[] {
    return new LabelFamilies(Object.keys(this.catalog)).ordered
  }

  valuesOf(family: string): readonly string[] {
    return Object.keys(this.catalog[family] ?? {})
  }

  // Whether the keys are on the column that says how far back, the one after the families.
  get onSince(): boolean {
    return this.column === this.families.length
  }

  pressed(input: string, key: Key): FilterForm {
    if (key.escape) return this.with({ outcome: 'cancelled' })
    if (key.return) return this.with({ outcome: 'submitted' })
    if (input === 'x') return this.with({ chosen: {}, since: 'ever' })
    if (key.leftArrow || key.rightArrow) {
      const column = Math.min(this.families.length, Math.max(0, this.column + (key.rightArrow ? 1 : -1)))

      return this.with({ column, row: Math.min(this.row, Math.max(0, this.rowsOf(column) - 1)) })
    }
    if (key.upArrow) return this.with({ row: Math.max(0, this.row - 1) })
    if (key.downArrow) return this.with({ row: Math.min(this.rowsOf(this.column) - 1, this.row + 1) })
    if (input === ' ') return this.toggled()

    return this
  }

  refused(): FilterForm {
    return this.with({ outcome: 'open' })
  }

  private rowsOf(column: number): number {
    const family = this.families[column]

    return family === undefined ? FilterForm.SINCE.length : this.valuesOf(family).length
  }

  private toggled(): FilterForm {
    const family = this.families[this.column]

    if (family === undefined) return this.with({ since: FilterForm.SINCE[this.row] ?? this.since })

    const value = this.valuesOf(family)[this.row]
    const held = this.chosen[family] ?? []

    if (value === undefined) return this

    const next = held.includes(value)
      ? held.filter((other) => other !== value)
      : this.valuesOf(family).filter((other) => other === value || held.includes(other))

    return this.with({ chosen: { ...this.chosen, [family]: next } })
  }

  private with(change: Partial<Fields>): FilterForm {
    const { chosen, since, column, row, outcome } = this

    return new FilterForm(this.catalog, this.listing, { chosen, since, column, row, outcome, ...change })
  }
}
