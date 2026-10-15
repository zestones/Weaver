import { counted } from '../lib/text/counted.ts'
import { DeclarationFolder } from '../declaration/reading/declaration-folder.ts'
import type { UnitDiff } from '../unit-of-work/diff/unit-diff.ts'
import type { EventBody } from '../unit-of-work/journal/journal-event.ts'
import type { UnitOfWork } from '../unit-of-work/unit/unit-of-work.ts'
import type { LiftedCall } from '../unit-of-work/unit/unit-record.ts'
import { UnitReview } from '../review/rounds/unit-review.ts'
import type { CheckOutcome } from '../checks/results/check-outcome.ts'
import { ValidationList, type ValidationItem } from './validation-list.ts'

export interface VerdictFields {
  readonly unit: UnitOfWork
  readonly maxRefusals: number
  readonly diff: UnitDiff
  readonly outcomes: readonly CheckOutcome[]
  readonly repaired: readonly string[]
  readonly review: UnitReview | null
  readonly ms: number
}

// The one rule the engine brings itself: the declaration that says what is checked is the owner's.
const DECLARATION_RULE = 'weaver:declaration'
// And the one that follows what the owner's maintenance let through.
const MAINTENANCE_RULE = 'weaver:maintenance'
// How a guard names a write it refuses.
const WRITTEN = /^Writing (.+)$/

export class UnitVerdict {
  readonly unit: number
  readonly round: number
  readonly maxRefusals: number
  readonly diff: UnitDiff
  readonly unattributed: readonly string[]
  // The calls a guard would have refused, which the owner's maintenance let through.
  readonly lifted: readonly LiftedCall[]
  readonly outcomes: readonly CheckOutcome[]
  // The files the repairs of the checks rewrote before the verdict.
  readonly repaired: readonly string[]
  // null when no review was asked: no reviewer declared, no rule for one, or checks that fail.
  readonly review: UnitReview | null
  readonly ms: number

  constructor(fields: VerdictFields) {
    this.unit = fields.unit.number
    this.round = fields.unit.rounds + 1
    this.maxRefusals = fields.maxRefusals
    this.diff = fields.diff
    this.unattributed = fields.unit.unattributed
    this.lifted = fields.unit.lifted
    this.outcomes = fields.outcomes
    this.repaired = fields.repaired
    this.review = fields.review
    this.ms = fields.ms
  }

  get blocking(): CheckOutcome[] {
    return this.outcomes.filter((outcome) => outcome.blocking)
  }

  get passed(): boolean {
    return this.blocking.length === 0
  }

  // What waits for the owner, a file at a time.
  toValidate(): ValidationList {
    const findings = this.outcomes.flatMap((outcome) =>
      outcome.toValidate.map(({ rule, file, line, message }) => ({ file, rule, line: line ?? null, message })),
    )
    const advisory = this.outcomes
      .filter((outcome) => outcome.failedWithoutBlocking)
      .map((outcome) => this.unplaced('', `${this.behind(outcome)} reports: ${outcome.excerpt().slice(0, 3).join(' / ')}`))
    const declaration = this.diff.changesUnder(DeclarationFolder.NAME)
      ? [this.unplaced(DECLARATION_RULE, `${DeclarationFolder.NAME}: the unit changed the project's declaration`)]
      : []

    return new ValidationList([...findings, ...advisory, ...this.liftedItems(), ...declaration, ...this.reviewItems()])
  }

  // A write is about its file; anything else a guard refuses is about the change.
  private liftedItems(): ValidationItem[] {
    return this.lifted.map(({ guard, what }) => {
      const written = WRITTEN.exec(what)?.[1] ?? null

      return written === null
        ? this.unplaced(MAINTENANCE_RULE, `${guard}: ${what} went through in maintenance, which this guard refuses`)
        : { file: written, rule: MAINTENANCE_RULE, line: null, message: `written, which the guard ${guard} refuses` }
    })
  }

  private reviewItems(): ValidationItem[] {
    const { review } = this

    if (review === null) return []

    const points = review.points().map(({ place, content }) => ({
      file: place?.file ?? null,
      rule: `${content.review} ${content.rule ?? UnitReview.SUSPICION_RULE}`,
      line: place?.line ?? null,
      message: `${content.message} (${content.standing})`,
    }))

    return points.length > 0 ? points : review.toValidate().map((line) => this.unplaced('', line))
  }

  private unplaced(rule: string, message: string): ValidationItem {
    return { file: null, rule, line: null, message }
  }

  private behind(outcome: CheckOutcome): string {
    const { concerned, rules, id } = outcome

    return concerned.length > 0 ? `${concerned.join(' ')} the check ${id}` : `the check ${id}, behind ${counted(rules.length, 'rule')},`
  }

  event(): EventBody {
    return {
      kind: 'check',
      unit: this.unit,
      round: this.round,
      passed: this.passed,
      failed: this.blocking.map((outcome) => outcome.id),
      toValidate: this.toValidate().items.length,
      files: this.diff.files.length,
      lines: this.diff.addedLines,
      repaired: this.repaired.length,
      ms: this.ms,
      checks: this.outcomes.map((outcome) => outcome.run),
    }
  }
}
