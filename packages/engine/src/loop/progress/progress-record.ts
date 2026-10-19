import type { CheckStatus } from '../../checks/results/check-outcome.ts'

export interface CheckProgressRecord {
  readonly id: string
  // `waiting` until it starts, `running` until it ends.
  readonly status: CheckStatus | 'waiting' | 'running'
  readonly startedAt: string | null
  readonly ms: number | null
  // Given again from an earlier run: nothing it reads changed since.
  readonly kept: boolean
  // How long it usually takes in the project; null when it never ran there.
  readonly usualMs: number | null
}

export interface ReviewProgressRecord {
  readonly status: 'waiting' | 'running' | 'over'
  readonly startedAt: string | null
  readonly endedAt: string | null
  // How the review stands once it is over, as the review says it, or `none due` when there was nothing to review.
  readonly standing: string | null
  // The runtime that reviewed, once it is over.
  readonly reviewer: string | null
  readonly usualMs: number | null
}

// What an end of task is doing, as it goes: written by the hook at each step, read by whoever waits for it.
export interface ProgressRecord {
  readonly unit: number
  // The process of the hook: an end of task whose process is gone was stopped before its end.
  readonly pid: number
  readonly startedAt: string
  // How long an end of task usually takes in the project; null before the first.
  readonly usualMs: number | null
  readonly step: 'repairs' | 'checks' | 'review' | 'over'
  readonly checks: readonly CheckProgressRecord[]
  // null when the project asks for no review.
  readonly review: ReviewProgressRecord | null
  readonly endedAt: string | null
  // What it came to, in a few words; null until it is over.
  readonly outcome: string | null
}
