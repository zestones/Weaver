import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ChangedFile } from '../../lib/git/tree-diff.ts'
import type { ReviewCriterion } from '../request/review-request.ts'
import { FINDINGS_LIMIT, type Experiment, type ReviewFinding, type Suspicion } from './review-finding.ts'

export interface ReadAnswer {
  readonly summary: string
  readonly findings: readonly ReviewFinding[]
  readonly suspicions: readonly Suspicion[]
  readonly experiments: readonly Experiment[]
  // What the reviewer reported and the author will not read, each with why.
  readonly dropped: readonly string[]
  // Findings past the limit.
  readonly truncated: number
}

type Placed = { readonly finding: ReviewFinding } | { readonly suspicion: Suspicion } | { readonly dropped: string }
type Fields = Readonly<Record<string, unknown>>

// A line number that drifted by a few lines still points at the same code; further away it is another place.
const LINE_TOLERANCE = 3

// What survives of a reviewer's answer: findings on what the unit changed, under the rules it was given, one per place.
// A claim about what the code does, without the experiment that shows it, becomes a suspicion for the owner.
export class AnswerReader {
  private readonly rules: readonly ReviewCriterion[]
  private readonly files: readonly ChangedFile[]
  private readonly top: string

  constructor(rules: readonly ReviewCriterion[], files: readonly ChangedFile[], top: string) {
    this.rules = rules
    this.files = files
    this.top = top
  }

  // null when the answer holds no list of findings at all.
  read(answer: unknown): ReadAnswer | null {
    const given = this.fields(answer)

    if (given === null || !Array.isArray(given.findings)) return null

    const kept = new Map<string, ReviewFinding>()
    const suspicions = this.list(given.suspicions).flatMap((item) => this.suspicion(item))
    const dropped: string[] = []

    for (const placed of given.findings.map((item) => this.place(item))) {
      if ('dropped' in placed) dropped.push(placed.dropped)
      else if ('suspicion' in placed) suspicions.push(placed.suspicion)
      else if (kept.has(this.where(placed.finding))) dropped.push(`${this.where(placed.finding)}: said twice`)
      else kept.set(this.where(placed.finding), placed.finding)
    }

    const ranked = [...kept.values()].sort((left, right) => this.rank(left) - this.rank(right))

    return {
      summary: this.text(given.summary) ?? '',
      findings: ranked.slice(0, FINDINGS_LIMIT),
      suspicions,
      experiments: this.list(given.experiments).flatMap((item) => this.experiment(item)),
      dropped,
      truncated: Math.max(0, ranked.length - FINDINGS_LIMIT),
    }
  }

  private place(value: unknown): Placed {
    const given = this.fields(value) ?? {}
    const rule = this.rules.find((asked) => asked.id === given.rule)
    const [named, problem] = [this.text(given.file), this.text(given.problem)]
    const asked = typeof given.line === 'number' && Number.isInteger(given.line) ? given.line : null

    if (named === null || problem === null) return { dropped: 'a finding without its file or what is wrong' }

    const where = `${String(given.rule)} ${named}${asked === null ? '' : `:${String(asked)}`}`
    // A reviewer may name a file from the root of the machine: the changed file it ends with is the one it means.
    const file = this.files.find(({ path }) => named === path || named.endsWith(`/${path}`))

    if (rule === undefined) return { dropped: `${where}: a rule the reviewer was not given` }
    if (file === undefined) return { dropped: `${where}: the unit did not change this file` }

    const quote = this.text(given.quote)
    const line = asked !== null && this.changes(file, asked) ? asked : this.lineOf(quote, file)

    if (line === null && asked !== null) return { dropped: `${where}: the unit changed no line there, and the quote matches none` }

    const evidence = this.text(given.evidence)

    if (rule.evidence && evidence === null) {
      return { suspicion: { file: file.path, note: `${problem} (${rule.id}, without the experiment that shows it)` } }
    }

    return {
      finding: {
        rule: rule.id,
        file: file.path,
        ...(line === null ? {} : { line }),
        message: problem,
        quote,
        suggestion: this.text(given.suggestion),
        evidence,
      },
    }
  }

  private changes(file: ChangedFile, line: number): boolean {
    return file.added.some(([start, end]) => line >= start - LINE_TOLERANCE && line <= end + LINE_TOLERANCE)
  }

  // A reviewer that miscounts still quotes the line it means, so the quote decides where the finding goes.
  private lineOf(quote: string | null, file: ChangedFile): number | null {
    const source = this.source(file.path)

    if (quote === null || source === null) return null

    const lines = source.split('\n').flatMap((text, index) => (text.trim() === quote && this.changes(file, index + 1) ? [index + 1] : []))

    return lines.length === 1 ? (lines[0] ?? null) : null
  }

  private source(path: string): string | null {
    try {
      return readFileSync(join(this.top, path), 'utf8')
    } catch {
      return null
    }
  }

  // What needs an experiment is about what the code does: it comes first.
  private rank(finding: ReviewFinding): number {
    return this.rules.find((rule) => rule.id === finding.rule)?.evidence === true ? 0 : 1
  }

  private where(finding: ReviewFinding): string {
    return `${finding.rule} ${finding.file}:${String(finding.line ?? '')}`
  }

  private suspicion(value: unknown): Suspicion[] {
    const given = this.fields(value) ?? {}
    const note = this.text(given.note)

    return note === null ? [] : [{ file: this.text(given.file), note }]
  }

  private experiment(value: unknown): Experiment[] {
    const given = this.fields(value) ?? {}
    const [command, observed] = [this.text(given.command), this.text(given.observed)]

    return command === null || observed === null ? [] : [{ command, observed }]
  }

  private list(value: unknown): unknown[] {
    return Array.isArray(value) ? value : []
  }

  private fields(value: unknown): Fields | null {
    return typeof value === 'object' && value !== null ? (value as Fields) : null
  }

  private text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
  }
}
