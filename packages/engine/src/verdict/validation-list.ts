export interface ValidationItem {
  // The file it is about; null for what is about the change as a whole.
  readonly file: string | null
  // The rule or the mechanism it comes from; '' when there is none to name.
  readonly rule: string
  readonly line: number | null
  readonly message: string
}

export interface Validation {
  readonly file: string | null
  readonly reasons: readonly string[]
}

const SUBJECT_END = ': '

// What waits for the owner, one entry for each file with every reason it waits: a file that several checks, rules or
// guards name is read once, and what one rule says of several places of it in the same words is said once. What is
// about no file comes last.
export class ValidationList {
  readonly items: readonly ValidationItem[]

  constructor(items: readonly ValidationItem[]) {
    this.items = items
  }

  get entries(): Validation[] {
    const files = [...new Set(this.items.flatMap((item) => (item.file === null ? [] : [item.file])))]
    const placed = files.map((file) => ({ file, reasons: this.reasons(this.items.filter((item) => item.file === file)) }))
    const unplaced = this.items.filter((item) => item.file === null).map((item) => ({ file: null, reasons: [this.reason(item)] }))

    return [...placed, ...unplaced]
  }

  lines(): string[] {
    return this.entries.flatMap(({ file, reasons }) =>
      file === null ? reasons.map((reason) => `- ${reason}`) : [`- ${file}`, ...reasons.map((reason) => `  - ${reason}`)],
    )
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

    return [`${this.named(first.rule)}${String(items.length)} places: ${tails[0] ?? ''} (${subjects.join(', ')})`]
  }

  private reason(item: ValidationItem): string {
    const line = item.line === null ? '' : `line ${String(item.line)}: `

    return `${this.named(item.rule)}${line}${item.message}`
  }

  private named(rule: string): string {
    return rule === '' ? '' : `${rule}, `
  }

  private tail(message: string): string {
    const end = message.indexOf(SUBJECT_END)

    return end === -1 ? '' : message.slice(end + SUBJECT_END.length)
  }
}
