import type { Did, FlagFields } from './flag-record.ts'

type Keyword = 'Seen' | 'Expected' | 'Found' | 'Checked' | 'Did' | 'Decision'

// What an agent is asked for when a field cannot be used.
const ASKS: Readonly<Record<Keyword, string>> = {
  Decision: 'say `none` or `owner` followed by the question',
  Seen: 'say what you saw, the fact and not what you conclude from it, or that it is unknown',
  Expected: 'say what you expected instead, or that it is unknown',
  Found: 'say what you were doing and what alerted you, or that it is unknown',
  Checked: 'say what you verified and what you did not, or that it is unknown',
  Did: 'start it with `left as it is`, `worked around` or `fixed in the task`',
}
const KEYWORDS = Object.keys(ASKS) as Keyword[]
const KEYWORD = /^(seen|expected|found|checked|did|decision):(.*)$/i
const DONE: readonly (readonly [RegExp, Did])[] = [
  [/^left(?: as (?:it )?is)?(?![\w-])/i, 'left'],
  [/^worked[ -]around(?![\w-])/i, 'worked-around'],
  [/^fixed(?: in (?:the|this) task)?(?![\w-])/i, 'fixed'],
]
const QUOTED_LENGTH = 40

// Missing decisions remain unknown, including flags from before the decision field existed.
export class FlagText {
  // The format, for an agent that got it wrong: shown under the problems.
  static readonly FORMAT: string = [
    "weaver flag <file>[:<line>] ... <<'EOF'",
    'Seen: what you saw: the fact, not what you conclude from it.',
    'Expected: what you expected instead.',
    'Found: what you were doing, and what alerted you.',
    'Checked: what you verified, and what you did not.',
    'Did: left as it is | worked around | fixed in the task, then anything to add.',
    'Decision: none | owner <the question>',
    'EOF',
    'Each keyword starts a line, once. A field may span lines, and may say that it is unknown. The places are optional.',
  ].join('\n')

  // Each keyword with what follows it, as many times as the body gives it.
  private readonly given: readonly (readonly [Keyword, string])[]

  constructor(body: string) {
    const fields: { readonly keyword: Keyword; readonly lines: string[] }[] = []

    for (const line of body.split(/\r?\n/)) {
      const [, word, rest] = KEYWORD.exec(line) ?? []
      const keyword = KEYWORDS.find((known) => known.toLowerCase() === word?.toLowerCase())

      if (keyword === undefined) fields.at(-1)?.lines.push(line)
      else fields.push({ keyword, lines: [rest ?? ''] })
    }

    this.given = fields.map(({ keyword, lines }) => [keyword, lines.join('\n').trim()])
  }

  // Empty when the flag can be recorded. A field is never judged by its length, which would only invite filling.
  problems(): string[] {
    return KEYWORDS.flatMap((keyword) => {
      const values = this.values(keyword)
      const [value] = values

      if (keyword === 'Decision') return []
      if (value === undefined) return [`\`${keyword}:\` is missing: ${ASKS[keyword]}.`]
      if (values.length > 1) return [`\`${keyword}:\` is given ${String(values.length)} times: give it once.`]
      if (value === '') return [`\`${keyword}:\` says nothing: ${ASKS[keyword]}.`]
      if (keyword === 'Did' && this.done(value) === null) {
        return [`\`Did:\` starts with "${value.slice(0, QUOTED_LENGTH)}": ${ASKS.Did}, then add what you want.`]
      }

      return []
    })
  }

  // null while `problems()` is not empty.
  fields(): FlagFields | null {
    const done = this.done(this.values('Did')[0] ?? '')

    if (done === null || this.problems().length > 0) return null

    return {
      seen: this.values('Seen')[0] ?? '',
      expected: this.values('Expected')[0] ?? '',
      found: this.values('Found')[0] ?? '',
      checked: this.values('Checked')[0] ?? '',
      ...done,
      decision: this.decision(),
    }
  }

  private decision(): NonNullable<FlagFields['decision']> {
    const values = this.values('Decision')
    const value = values[0] ?? ''
    const owner = values.flatMap((entry) => /^owner\s+([\s\S]+)$/i.exec(entry)?.[1]?.trim() || []).at(0)

    if (owner !== undefined) return { kind: 'owner', question: owner }
    if (values.length === 1 && /^none$/i.test(value)) return { kind: 'none', question: null }
    return { kind: 'unknown', question: null }
  }

  private values(keyword: Keyword): string[] {
    return this.given.flatMap(([given, value]) => (given === keyword ? [value] : []))
  }

  private done(value: string): Pick<FlagFields, 'did' | 'didNote'> | null {
    for (const [start, did] of DONE) {
      const [words] = start.exec(value) ?? []

      if (words !== undefined) {
        const note = value.slice(words.length).replace(/^[\s.,;:—–-]+/, '')

        return { did, didNote: note === '' ? null : note }
      }
    }

    return null
  }
}
