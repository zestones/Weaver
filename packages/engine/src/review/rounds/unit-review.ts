import type { EventBody } from '../../unit-of-work/journal/journal-event.ts'
import type { FindingAnswer } from '../answers/finding-answer.ts'
import type { ReviewOutcome } from '../results/review-outcome.ts'
import type { ReviewPoint } from './review-point.ts'

// running: the review goes on after this end of turn. sent-back: the author has findings to answer. answers-wanted:
// its answers are missing or cannot be taken. answered: each finding has its answer, or the author was asked enough.
// for-owner: found once the review may refuse no more.
export type ReviewStanding = 'running' | 'sent-back' | 'answers-wanted' | 'answered' | 'clean' | 'for-owner' | 'failed' | 'skipped'

export interface UnitReviewFields {
  readonly standing: ReviewStanding
  // The content of the unit the review judged, which the review is kept under.
  readonly content: string
  readonly outcome: ReviewOutcome
  readonly round: number
  readonly maxRefusals: number
  readonly answers?: readonly FindingAnswer[]
  readonly problems?: readonly string[]
  // The model that reviewed and how many rules it was given, for a review that ran.
  readonly model?: string | null
  readonly rules?: number
}

const REVIEW_RULE = 'weaver:review'
const SUSPICION_RULE = 'weaver:suspicion'
const KEY_LENGTH = 7
const HOLDING: ReadonlySet<ReviewStanding> = new Set(['sent-back', 'answers-wanted'])
const ENDING: ReadonlySet<ReviewStanding> = new Set(['answered', 'clean', 'for-owner'])
const JUST_RUN: ReadonlySet<ReviewStanding> = new Set(['running', 'sent-back', 'clean', 'for-owner', 'failed', 'skipped'])

// What a review means for the unit it judged, at one end of turn.
export class UnitReview {
  readonly standing: ReviewStanding
  readonly content: string
  readonly outcome: ReviewOutcome
  readonly round: number
  readonly maxRefusals: number
  readonly answers: readonly FindingAnswer[]
  // What keeps the author's answers from being taken.
  readonly problems: readonly string[]
  private readonly model: string | null
  private readonly rules: number

  constructor(fields: UnitReviewFields) {
    this.standing = fields.standing
    this.content = fields.content
    this.outcome = fields.outcome
    this.round = fields.round
    this.maxRefusals = fields.maxRefusals
    this.answers = fields.answers ?? []
    this.problems = fields.problems ?? []
    this.model = fields.model ?? null
    this.rules = fields.rules ?? 0
  }

  // A finding never holds a change by itself: the author is held until it has answered, not until it has complied.
  get holds(): boolean {
    return HOLDING.has(this.standing)
  }

  // Whether the rules of the review were judged at all.
  get judged(): boolean {
    return this.standing !== 'failed' && this.standing !== 'skipped' && this.standing !== 'running'
  }

  answerOf(index: number): FindingAnswer | null {
    return this.answers.find((answer) => answer.finding === index + 1) ?? null
  }

  toValidate(): string[] {
    const { outcome, standing } = this

    if (standing === 'failed')
      return [`${REVIEW_RULE} the review by ${outcome.runtime} did not give its findings: ${outcome.failure ?? ''}`]

    return this.points().map(({ place, content }) => {
      const where = place === null ? 'the change' : `${place.file}${place.line === null ? '' : `:${String(place.line)}`}`

      return `${content.review} ${content.rule ?? SUSPICION_RULE} ${where}: ${content.message} (${content.standing})`
    })
  }

  // What the review leaves for the owner once the unit ends, each under its name in this review.
  points(): ReviewPoint[] {
    const { outcome } = this
    const key = this.content.slice(0, KEY_LENGTH)

    if (!ENDING.has(this.standing)) return []

    const findings = outcome.findings.flatMap((finding, index): ReviewPoint[] => {
      const standing = this.left(index)
      const { rule, file, message, quote, suggestion, evidence } = finding
      const review = `${key}/F${String(index + 1)}`

      return standing === null
        ? []
        : [
            {
              origin: 'finding',
              place: { file, line: finding.line ?? null },
              content: { review, rule, message, quote, suggestion, evidence, standing },
            },
          ]
    })
    const suspicions = outcome.suspicions.map(({ file, note }, index): ReviewPoint => ({
      origin: 'suspicion',
      place: file === null ? null : { file, line: null },
      content: {
        review: `${key}/S${String(index + 1)}`,
        rule: null,
        message: note,
        quote: null,
        suggestion: null,
        evidence: null,
        standing: 'suspected by the reviewer, not verified',
      },
    }))

    return [...findings, ...suspicions]
  }

  events(unit: number): EventBody[] {
    const { outcome, standing } = this
    const { runtime, reason, failure, seconds, costUsd } = outcome

    if (standing === 'answered') {
      return outcome.findings.map((finding, index): EventBody => ({
        kind: 'answer',
        unit,
        finding: index + 1,
        rule: finding.rule,
        status: this.answerOf(index)?.status ?? 'missing',
      }))
    }

    if (!JUST_RUN.has(standing)) return []

    const counts = {
      rules: this.rules,
      findings: outcome.findings.length,
      findingRules: outcome.findings.map((finding) => finding.rule),
      suspicions: outcome.suspicions.length,
      dropped: outcome.dropped.length + outcome.truncated,
      experiments: outcome.experiments.length,
    }

    return [{ kind: 'review', unit, runtime, model: this.model, reason, standing, ...counts, failure, seconds, costUsd }]
  }

  // Why a finding still waits for the owner once the unit ends; null when the author fixed it.
  private left(index: number): string | null {
    const answer = this.answerOf(index)

    if (this.standing === 'for-owner') return 'found by the last review, which the agent has not seen'
    if (answer === null) return 'the agent gave no answer that could be taken'

    return answer.status === 'fixed' ? null : `not fixed by the agent: ${answer.why}`
  }
}
