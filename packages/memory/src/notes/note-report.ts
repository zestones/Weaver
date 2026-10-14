import type { Conclusion } from '../cards/card-record.ts'

// What a note that concludes reports: what was looked into, or what was changed.
export type ReportKind = 'investigation' | 'fix'

export interface ReportField {
  readonly name: string
  readonly said: string
}

interface Asked {
  readonly name: string
  // What the format says after the keyword.
  readonly holds: string
  // What an agent is asked for when the field cannot be used.
  readonly asks: string
}

// The fields of each report, in the order they are read.
const FIELDS: Readonly<Record<ReportKind, readonly Asked[]>> = {
  investigation: [
    { name: 'Ran', holds: 'what you ran, and what it showed.', asks: 'say what you ran and what it showed, or that you ran nothing' },
    { name: 'Read', holds: 'what you read without running it.', asks: 'say what you read without running it, or that you read nothing' },
    { name: 'Shows', holds: 'what this proves, and what it does not.', asks: 'say what this proves, and what it does not' },
  ],
  fix: [
    { name: 'Changed', holds: 'what you changed, and where.', asks: 'say what you changed, and where' },
    {
      name: 'Verified',
      holds: 'how you checked it afterwards, and what that showed.',
      asks: 'say how you checked it afterwards and what that showed, or that you did not',
    },
    { name: 'Left', holds: 'what is left to do.', asks: 'say what is left to do, or that nothing is' },
  ],
}
// The field that says what a report comes to.
const OUTCOME: Readonly<Record<ReportKind, string>> = { investigation: 'Shows', fix: 'Changed' }

// Reads what a note that concludes says into the fields of its report, and says what keeps it from being one. The
// note is kept as it was typed: its fields are read each time it is shown, so one written before reports existed,
// or by the owner, who owes none, is read as the text it is.
export class NoteReport {
  static readonly KINDS: readonly ReportKind[] = ['investigation', 'fix']

  readonly kind: ReportKind
  // What the note says before its first field: all of it when it has none.
  readonly opening: string
  // Each keyword with what follows it, as many times as the note gives it.
  private readonly given: readonly ReportField[]

  constructor(conclusion: Conclusion, text: string) {
    const kind = NoteReport.kindOf(conclusion)
    const names = FIELDS[kind].map(({ name }) => name)
    const keyword = new RegExp(`^(${names.join('|')}):(.*)$`, 'i')
    const opening: string[] = []
    const fields: { readonly name: string; readonly lines: string[] }[] = []

    for (const line of text.split(/\r?\n/)) {
      const [, word, rest] = keyword.exec(line) ?? []
      const name = names.find((known) => known.toLowerCase() === word?.toLowerCase())

      if (name !== undefined) fields.push({ name, lines: [rest ?? ''] })
      else (fields.at(-1)?.lines ?? opening).push(line)
    }

    this.kind = kind
    this.opening = opening.join('\n').trim()
    this.given = fields.map(({ name, lines }) => ({ name, said: lines.join('\n').trim() }))
  }

  static kindOf(conclusion: Conclusion): ReportKind
  static kindOf(conclusion: Conclusion | null): ReportKind | null
  static kindOf(conclusion: Conclusion | null): ReportKind | null {
    if (conclusion === null) return null

    return conclusion === 'fixed' ? 'fix' : 'investigation'
  }

  // The lines a report of this kind is made of, as the format shows them.
  static asked(kind: ReportKind): string[] {
    return FIELDS[kind].map(({ name, holds }) => `${name}: ${holds}`)
  }

  // The fields the note gives, in the order of the report. A keyword given several times is one field: an agent
  // that ran three commands says so on three lines.
  get fields(): ReportField[] {
    return FIELDS[this.kind].flatMap(({ name }) => {
      const values = this.values(name)

      return values.length === 0 ? [] : [{ name, said: values.filter((value) => value !== '').join('\n') }]
    })
  }

  // What the report comes to: what an investigation shows, what a fix changed. null when the note does not say.
  get outcome(): string | null {
    const said = this.fields.find(({ name }) => name === OUTCOME[this.kind])?.said ?? ''

    return said === '' ? null : said
  }

  // Empty when the note is a report. A field is never judged by its length, which would only invite filling.
  problems(): string[] {
    return FIELDS[this.kind].flatMap(({ name, asks }) => {
      const values = this.values(name)

      if (values.length === 0) return [`\`${name}:\` is missing: ${asks}.`]

      return values.every((value) => value === '') ? [`\`${name}:\` says nothing: ${asks}.`] : []
    })
  }

  private values(name: string): string[] {
    return this.given.flatMap((field) => (field.name === name ? [field.said] : []))
  }
}
