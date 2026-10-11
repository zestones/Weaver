import type { EventBody } from '../../unit-of-work/journal/journal-event.ts'
import type { FindingAnswer } from '../answers/finding-answer.ts'
import type { OwnerPoint } from '../ledger/owner-point.ts'
import { ReviewLedger } from '../ledger/review-ledger.ts'
import type { ReviewOutcome } from '../results/review-outcome.ts'

// running: the review goes on after this end of turn. sent-back: the author has findings to answer. answers-wanted:
// its answers are missing or cannot be taken. answered: each finding has its answer, or the author was asked enough.
// for-owner: found after the last round.
export type ReviewStanding = 'running' | 'sent-back' | 'answers-wanted' | 'answered' | 'clean' | 'for-owner' | 'failed' | 'skipped'

export interface UnitReviewFields {
  readonly standing: ReviewStanding
  // The content of the unit the review judged, which the review is kept under.
  readonly content: string
  readonly outcome: ReviewOutcome
  readonly round: number
  readonly maxRounds: number
  readonly answers?: readonly FindingAnswer[]
  readonly problems?: readonly string[]
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
  readonly maxRounds: number
  readonly answers: readonly FindingAnswer[]
  // What keeps the author's answers from being taken.
  readonly problems: readonly string[]

  constructor(fields: UnitReviewFields) {
    this.standing = fields.standing
    this.content = fields.content
    this.outcome = fields.outcome
    this.round = fields.round
    this.maxRounds = fields.maxRounds
    this.answers = fields.answers ?? []
    this.problems = fields.problems ?? []
  }

  // A finding never holds a change by itself: the author is held until it has answered, not until it has complied.
  get holds(): boolean {
    return HOLDING.has(this.standing)
  }

  // Whether the rules of level llm were judged at all.
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

    return this.points('').map((point) => `${point.id} ${ReviewLedger.describe(point)} (${point.standing})`)
  }

  // What the review leaves for the owner once the unit ends, each under a name the owner closes it by.
  points(session: string): OwnerPoint[] {
    const { outcome } = this
    const at = new Date().toISOString()
    const key = this.content.slice(0, KEY_LENGTH)

    if (!ENDING.has(this.standing)) return []

    const findings = outcome.findings.flatMap((finding, index): OwnerPoint[] => {
      const standing = this.left(index)
      const { rule, file, message } = finding

      return standing === null
        ? []
        : [{ id: `${key}/F${String(index + 1)}`, rule, file, line: finding.line ?? null, message, standing, session, at }]
    })
    const suspicions = outcome.suspicions.map(({ file, note }, index): OwnerPoint => ({
      id: `${key}/S${String(index + 1)}`,
      rule: SUSPICION_RULE,
      file,
      line: null,
      message: note,
      standing: 'suspected by the reviewer, not verified',
      session,
      at,
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
      findings: outcome.findings.length,
      suspicions: outcome.suspicions.length,
      dropped: outcome.dropped.length + outcome.truncated,
    }

    return [{ kind: 'review', unit, runtime, reason, standing, ...counts, failure, seconds, costUsd }]
  }

  // Why a finding still waits for the owner once the unit ends; null when the author fixed it.
  private left(index: number): string | null {
    const answer = this.answerOf(index)

    if (this.standing === 'for-owner') return 'found by the last review, which the agent has not seen'
    if (answer === null) return 'the agent gave no answer that could be taken'

    return answer.status === 'fixed' ? null : `not fixed by the agent: ${answer.why}`
  }
}
