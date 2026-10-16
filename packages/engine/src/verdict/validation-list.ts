export interface ValidationItem {
  // The file it is about; null for what is about the change as a whole.
  readonly file: string | null
  // The rule or the mechanism it comes from; '' when there is none to name.
  readonly rule: string
  readonly line: number | null
  readonly message: string
}

export interface Validation {
  // The files that wait for the same reasons; none for what is about the change as a whole.
  readonly files: readonly string[]
  readonly reasons: readonly string[]
}

const SUBJECT_END = ': '

// What waits for the owner, one entry for each file with every reason it waits: a file that several checks, rules or
// guards name is read once, and what one rule says of several places of it in the same words is said once. Files that
// wait for the same reasons, as the files of a folder that moved do, are one entry. What is about no file comes last.
export class ValidationList {
  readonly items: readonly ValidationItem[]

  constructor(items: readonly ValidationItem[]) {
    this.items = items
  }

  get entries(): Validation[] {
    const files = [...new Set(this.items.flatMap((item) => (item.file === null ? [] : [item.file])))]
    const placed = new Map<string, { files: string[]; reasons: string[] }>()

    for (const file of files) {
      const reasons = this.reasons(this.items.filter((item) => item.file === file))
      const same = placed.get(reasons.join('\n'))

      if (same === undefined) placed.set(reasons.join('\n'), { files: [file], reasons })
      else same.files.push(file)
    }

    const unplaced = this.items.filter((item) => item.file === null).map((item) => ({ files: [], reasons: [this.reason(item)] }))

    return [...placed.values(), ...unplaced]
  }

  // Each file that waits, and each point about no file.
  get count(): number {
    return this.entries.reduce((count, { files }) => count + Math.max(files.length, 1), 0)
  }

  lines(): string[] {
    return this.entries.flatMap(({ files, reasons }) =>
      files.length === 0 ? reasons.map((reason) => `- ${reason}`) : [`- ${this.named(files)}`, ...reasons.map((reason) => `  - ${reason}`)],
    )
  }

  // Several files are named from the folder they share.
  private named(files: readonly string[]): string {
    const [first = ''] = files

    if (files.length === 1) return first

    const folders = files.map((file) => file.split('/').slice(0, -1))
    const [one = []] = folders
    const apart = one.findIndex((part, depth) => folders.some((folder) => folder[depth] !== part))
    const shared = one
      .slice(0, apart === -1 ? one.length : apart)
      .map((part) => `${part}/`)
      .join('')
    const where = shared === '' ? '' : ` under ${shared}`

    return `${String(files.length)} files${where}: ${files.map((file) => file.slice(shared.length)).join(', ')}`
  }

  private reasons(items: readonly ValidationItem[]): string[] {
    const rules = [...new Set(items.map((item) => item.rule))]

    return rules.flatMap((rule) => this.merged(items.filter((item) => item.rule === rule)))
  }

  // Several places under one rule whose messages end alike, `<subject>: <the same words>`, are one reason.
  private merged(items: readonly ValidationItem[]): string[] {
    const [first] = items
    const tails = items.map((item) => this.tail(item.message))

    if (first === undefined || items.length === 1 || tails[0] === '' || tails.some((tail) => tail !== tails[0])) {
      return items.map((item) => this.reason(item))
    }

    const subjects = items.map((item) => item.message.slice(0, item.message.length - (tails[0] ?? '').length - SUBJECT_END.length))

    return [`${this.ruled(first.rule)}${String(items.length)} places: ${tails[0] ?? ''} (${subjects.join(', ')})`]
  }

  private reason(item: ValidationItem): string {
    const line = item.line === null ? '' : `line ${String(item.line)}: `

    return `${this.ruled(item.rule)}${line}${item.message}`
  }

  private ruled(rule: string): string {
    return rule === '' ? '' : `${rule}, `
  }

  private tail(message: string): string {
    const end = message.indexOf(SUBJECT_END)

    return end === -1 ? '' : message.slice(end + SUBJECT_END.length)
  }
}
