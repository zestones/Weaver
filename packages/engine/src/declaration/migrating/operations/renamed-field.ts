import type { PartName } from '../../schema/declaration-document.ts'
import type { Change, Operation, PartDocuments } from './operation.ts'

// A field of each entry of a file takes another name: `fix` becomes `repair` in every check.
export class RenamedField implements Operation {
  private readonly part: PartName
  private readonly from: string
  private readonly to: string

  constructor(part: PartName, from: string, to: string) {
    this.part = part
    this.from = from
    this.to = to
  }

  apply(documents: PartDocuments): Change | null {
    const document = documents[this.part] ?? {}
    const entries = Object.entries(document).filter((entry): entry is [string, Record<string, unknown>] => this.carries(entry[1]))

    // In place, so that an entry keeps the order its owner wrote it in.
    for (const [name, entry] of entries) {
      document[name] = Object.fromEntries(Object.entries(entry).map(([key, value]) => [key === this.from ? this.to : key, value]))
    }

    return entries.length === 0
      ? null
      : { part: this.part, text: `\`${this.from}\` is now \`${this.to}\`, in ${String(entries.length)} place(s)` }
  }

  private carries(entry: unknown): boolean {
    return typeof entry === 'object' && entry !== null && !Array.isArray(entry) && this.from in entry
  }
}
