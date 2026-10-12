import type { PartName } from '../../schema/declaration-document.ts'

// The files of a declaration as they were parsed, each open to change.
export type PartDocuments = Partial<Record<PartName, Record<string, unknown>>>

export interface Change {
  readonly part: PartName
  // What was done, for the owner who reads the diff.
  readonly text: string
}

// One thing a migration does to the files of a declaration.
export interface Operation {
  // Changes the documents and says what it did; null when there was nothing for it to do.
  apply(documents: PartDocuments): Change | null
}
