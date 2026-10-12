import type { Change, Operation, PartDocuments } from '../operations/operation.ts'

// What one version of the format changed from the one before, as the operations that bring older files to it.
export abstract class Migration {
  // The version of the format it brings the files to.
  abstract readonly version: number
  abstract readonly name: string
  // What it changes, in a sentence for the owner.
  abstract readonly summary: string
  protected abstract readonly operations: readonly Operation[]

  // How it is named everywhere, and what its file is called.
  get label(): string {
    return `${String(this.version).padStart(4, '0')}-${this.name}`
  }

  apply(documents: PartDocuments): Change[] {
    return this.operations.flatMap((operation) => operation.apply(documents) ?? [])
  }
}
