import type { PartName } from '../../schema/declaration-document.ts'
import type { Change, Operation, PartDocuments } from './operation.ts'

// A field a file must now carry is added with the value a new project starts with. What the owner wrote is kept.
export class AddedField implements Operation {
  private readonly part: PartName
  private readonly path: readonly string[]
  private readonly value: unknown
  private readonly meaning: string

  constructor(part: PartName, path: readonly string[], value: unknown, meaning: string) {
    this.part = part
    this.path = path
    this.value = value
    this.meaning = meaning
  }

  apply(documents: PartDocuments): Change | null {
    const field = this.path.at(-1)
    const holder = this.path
      .slice(0, -1)
      .reduce<unknown>((within, key) => (this.isObject(within) ? within[key] : undefined), documents[this.part])

    if (field === undefined || !this.isObject(holder) || field in holder) return null

    holder[field] = this.value

    return { part: this.part, text: `${this.path.join('.')} added, at ${JSON.stringify(this.value)}: ${this.meaning}` }
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }
}
