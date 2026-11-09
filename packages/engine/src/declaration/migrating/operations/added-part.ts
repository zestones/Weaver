import type { PartName } from '../../schema/declaration-document.ts'
import type { Change, Operation, PartDocuments } from './operation.ts'

export class AddedPart implements Operation {
  private readonly part: PartName
  private readonly value: Record<string, unknown>
  private readonly meaning: string

  constructor(part: PartName, value: Record<string, unknown>, meaning: string) {
    this.part = part
    this.value = value
    this.meaning = meaning
  }

  apply(documents: PartDocuments): Change | null {
    if (documents[this.part] !== undefined) return null
    documents[this.part] = { ...this.value }
    return { part: this.part, text: this.meaning }
  }
}
