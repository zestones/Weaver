import { basename } from 'node:path'
import type { ReviewFinding } from '../findings/review-finding.ts'
import type { FindingAnswer } from './finding-answer.ts'

const LINE = /^[\s>*-]*`?\**F(\d+)\**`?\s*[:.·—–-]?\s*\**(fixed|not[ -]?fixed)\**\s*[:.·—–-]?\s*(.*)$/i
const MIN_WHY = 10

// What the work became since the review: the files that hold what the review saw, and those that do not.
export interface SinceReview {
  readonly unchanged: ReadonlySet<string>
  readonly changed: readonly string[]
}

// The author answers each finding in its final message, one line each: `F1 fixed: ...` or `F2 not fixed: ...`.
export class AuthorAnswers {
  private readonly answers: ReadonlyMap<number, FindingAnswer>

  constructor(message: string | null) {
    const answers = (message ?? '').split('\n').flatMap((line): [number, FindingAnswer][] => {
      const [, number, status = '', why = ''] = LINE.exec(line) ?? []
      const finding = Number(number)

      return number === undefined ? [] : [[finding, { finding, status: /^fixed$/i.test(status) ? 'fixed' : 'not-fixed', why: why.trim() }]]
    })

    this.answers = new Map(answers)
  }

  // What keeps an answer from being taken, one line a finding.
  problems(findings: readonly ReviewFinding[], since: SinceReview): string[] {
    return findings.flatMap((finding, index) => this.problem(finding, index + 1, since) ?? [])
  }

  // The answers that can be taken as they are.
  taken(findings: readonly ReviewFinding[], since: SinceReview): FindingAnswer[] {
    return findings.flatMap((finding, index) => {
      const answer = this.answers.get(index + 1)

      return answer !== undefined && this.problem(finding, index + 1, since) === null ? [answer] : []
    })
  }

  // A finding may be fixed in another file than the one it is about, as a missing test is: the answer names it then.
  private problem(finding: ReviewFinding, number: number, since: SinceReview): string | null {
    const name = `F${String(number)}`
    const answer = this.answers.get(number)

    if (answer === undefined) return `${name} has no answer`
    if (answer.why.length < MIN_WHY) return `${name}: say what you changed, or why the finding does not hold`
    if (answer.status !== 'fixed' || !since.unchanged.has(finding.file)) return null

    const named = since.changed.some((path) => answer.why.includes(path) || answer.why.includes(basename(path)))

    return named
      ? null
      : `${name} is answered fixed, and ${finding.file} has not changed since the review: nothing is fixed yet. A fix made in another file is taken when the answer names that file`
  }
}
