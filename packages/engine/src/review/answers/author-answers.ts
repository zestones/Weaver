import type { ReviewFinding } from '../findings/review-finding.ts'
import type { FindingAnswer } from './finding-answer.ts'

const LINE = /^[\s>*-]*`?\**F(\d+)\**`?\s*[:.·—–-]?\s*\**(fixed|not[ -]?fixed)\**\s*[:.·—–-]?\s*(.*)$/i
const MIN_WHY = 10

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

  // What keeps an answer from being taken, one line a finding. `unchanged` holds the files that are as the review saw them.
  problems(findings: readonly ReviewFinding[], unchanged: ReadonlySet<string>): string[] {
    return findings.flatMap((finding, index) => this.problem(finding, index + 1, unchanged) ?? [])
  }

  // The answers that can be taken as they are.
  taken(findings: readonly ReviewFinding[], unchanged: ReadonlySet<string>): FindingAnswer[] {
    return findings.flatMap((finding, index) => {
      const answer = this.answers.get(index + 1)

      return answer !== undefined && this.problem(finding, index + 1, unchanged) === null ? [answer] : []
    })
  }

  private problem(finding: ReviewFinding, number: number, unchanged: ReadonlySet<string>): string | null {
    const name = `F${String(number)}`
    const answer = this.answers.get(number)

    if (answer === undefined) return `${name} has no answer`
    if (answer.why.length < MIN_WHY) return `${name}: say what you changed, or why the finding does not hold`

    return answer.status === 'fixed' && unchanged.has(finding.file)
      ? `${name} is answered fixed, and ${finding.file} has not changed since the review: nothing is fixed yet`
      : null
  }
}
