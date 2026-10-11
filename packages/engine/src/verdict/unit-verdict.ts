import { DeclarationFolder } from '../declaration/reading/declaration-folder.ts'
import type { UnitDiff } from '../unit-of-work/diff/unit-diff.ts'
import type { EventBody } from '../unit-of-work/journal/journal-event.ts'
import type { UnitOfWork } from '../unit-of-work/unit/unit-of-work.ts'
import type { UnitReview } from '../review/rounds/unit-review.ts'
import type { CheckOutcome } from '../checks/results/check-outcome.ts'

export interface VerdictFields {
  readonly unit: UnitOfWork
  readonly maxRounds: number
  readonly diff: UnitDiff
  readonly outcomes: readonly CheckOutcome[]
  readonly repaired: readonly string[]
  readonly review: UnitReview | null
  readonly ms: number
}

// The one rule the engine brings itself: the declaration that says what is checked is the owner's.
const DECLARATION_RULE = 'weaver:declaration'

export class UnitVerdict {
  readonly unit: number
  readonly round: number
  readonly maxRounds: number
  readonly diff: UnitDiff
  readonly unattributed: readonly string[]
  readonly outcomes: readonly CheckOutcome[]
  // The files the repairs of the checks rewrote before the verdict.
  readonly repaired: readonly string[]
  // null when no review was asked: no reviewer declared, no rule for one, or checks that fail.
  readonly review: UnitReview | null
  readonly ms: number

  constructor(fields: VerdictFields) {
    this.unit = fields.unit.number
    this.round = fields.unit.rounds + 1
    this.maxRounds = fields.maxRounds
    this.diff = fields.diff
    this.unattributed = fields.unit.unattributed
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

  toValidate(): string[] {
    const findings = this.outcomes.flatMap((outcome) => outcome.validationLines())
    const advisory = this.outcomes
      .filter((outcome) => outcome.failedWithoutBlocking)
      .map((outcome) => `${outcome.rules.join(' ')} the check ${outcome.id} reports: ${outcome.excerpt().slice(0, 3).join(' / ')}`)
    const declaration = this.diff.changesUnder(DeclarationFolder.NAME)
      ? [`${DECLARATION_RULE} ${DeclarationFolder.NAME}: the unit changed the project's declaration`]
      : []

    return [...findings, ...advisory, ...declaration, ...(this.review?.toValidate() ?? [])]
  }

  event(): EventBody {
    return {
      kind: 'check',
      unit: this.unit,
      round: this.round,
      passed: this.passed,
      failed: this.blocking.map((outcome) => outcome.id),
      toValidate: this.toValidate().length,
      files: this.diff.files.length,
      ms: this.ms,
    }
  }
}
