import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CheckWatcher } from '../../checks/running/check-watcher.ts'
import type { CheckOutcome } from '../../checks/results/check-outcome.ts'
import { isAlive } from '../../lib/process/alive.ts'
import type { CheckProgressRecord, ProgressRecord, ReviewProgressRecord } from './progress-record.ts'
import type { UsualTimes } from './usual-times.ts'

const FILE = 'progress.json'

// What an end of task is to do, as it starts.
export interface EndOfTaskPlan {
  readonly unit: number
  // The ids of the checks to run, in the order they are declared.
  readonly checks: readonly string[]
  readonly reviewed: boolean
  readonly usual: UsualTimes
}

// What an end of task is doing while the owner waits for it, kept in the session's folder at each step: the checks
// that ended and how, the one running and since when, then the review, each beside the time it usually takes. `weaver
// status` reads it, and so does what shows it in the agent's chat.
export class EndOfTaskProgress implements CheckWatcher {
  private readonly file: string
  private record: ProgressRecord

  constructor(dir: string, plan: EndOfTaskPlan) {
    const { unit, checks, reviewed, usual } = plan

    this.file = join(dir, FILE)
    this.record = {
      unit,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      usualMs: usual.whole,
      step: 'checks',
      checks: checks.map((id) => ({ id, status: 'waiting', startedAt: null, ms: null, kept: false, usualMs: usual.check(id) })),
      review: reviewed
        ? { status: 'waiting', startedAt: null, endedAt: null, standing: null, reviewer: null, usualMs: usual.review }
        : null,
      endedAt: null,
      outcome: null,
    }
    this.write()
  }

  // The last end of task of a session, running or over; null when it never had one.
  static read(dir: string): ProgressRecord | null {
    const file = join(dir, FILE)

    if (!existsSync(file)) return null

    try {
      return JSON.parse(readFileSync(file, 'utf8')) as ProgressRecord
    } catch {
      return null
    }
  }

  // An end of task that is not over and whose hook is gone was stopped: by the owner, or by its runtime.
  static isCut(record: ProgressRecord): boolean {
    return record.endedAt === null && !isAlive(record.pid)
  }

  repairing(): void {
    this.change({ step: 'repairs' })
  }

  checking(): void {
    this.change({ step: 'checks' })
  }

  started(id: string): void {
    this.changeCheck(id, { status: 'running', startedAt: new Date().toISOString() })
  }

  ended(outcome: CheckOutcome): void {
    this.changeCheck(outcome.id, { status: outcome.status, ms: outcome.ms, kept: outcome.keptFrom !== null })
  }

  reviewing(): void {
    this.changeReview({ status: 'running', startedAt: new Date().toISOString() })
    this.change({ step: 'review' })
  }

  reviewed(standing: string, reviewer: string | null): void {
    this.changeReview({ status: 'over', endedAt: new Date().toISOString(), standing, reviewer })
  }

  over(outcome: string): void {
    this.change({ step: 'over', endedAt: new Date().toISOString(), outcome })
  }

  private changeCheck(id: string, change: Partial<CheckProgressRecord>): void {
    this.change({ checks: this.record.checks.map((check) => (check.id === id ? { ...check, ...change } : check)) })
  }

  private changeReview(change: Partial<ReviewProgressRecord>): void {
    const { review } = this.record

    if (review !== null) this.record = { ...this.record, review: { ...review, ...change } }
  }

  private change(change: Partial<ProgressRecord>): void {
    this.record = { ...this.record, ...change }
    this.write()
  }

  // Written whole and moved in place: a reader never sees half of it. What waits for an end of task is told, and failing
  // to tell it never changes the end of task.
  private write(): void {
    const draft = `${this.file}.${String(process.pid)}.tmp`

    try {
      writeFileSync(draft, JSON.stringify(this.record, null, 2))
      renameSync(draft, this.file)
    } catch {
      return
    }
  }
}
