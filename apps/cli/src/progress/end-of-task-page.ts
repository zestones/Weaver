import { EndOfTaskProgress, type CheckProgressRecord, type ProgressRecord, type ReviewProgressRecord, type Session } from '@weaver/engine'
import type { UsualTimes } from '../numbers/usual-times.ts'
import { Duration } from '../output/duration.ts'
import { LocalMoment } from '../output/local-moment.ts'
import type { Screen } from '../output/screen.ts'

type Mark = 'done' | 'problem' | 'alert' | 'note' | 'running'

// A step of the end of a task: how it stands, how long it took or has run, and what else is to know of it.
interface Step {
  readonly mark: Mark
  readonly name: string
  readonly time: string
  readonly said: string
}

const REQUEST_LENGTH = 72
const REVIEW = 'review'
// How a review stands, in words, and the mark that says it.
const STANDINGS: Readonly<Record<string, readonly [Mark, string]>> = {
  running: ['done', 'goes on by itself'],
  'sent-back': ['problem', 'sends the agent back with findings'],
  'answers-wanted': ['problem', 'waits for the answers to its findings'],
  answered: ['done', 'each finding answered'],
  clean: ['done', 'found nothing'],
  'for-owner': ['alert', 'found what waits for you'],
  failed: ['problem', 'failed'],
  interrupted: ['alert', 'was stopped'],
  skipped: ['note', 'skipped'],
  'none due': ['note', 'nothing to review'],
}

// Where an end of task is, or how it ended: its checks one by one, then the review, each beside the time it usually
// takes in this project.
export class EndOfTaskPage {
  private readonly session: Session
  private readonly record: ProgressRecord
  private readonly usual: UsualTimes
  private readonly now: number
  private readonly cut: boolean

  constructor(session: Session, record: ProgressRecord, usual: UsualTimes, now: number) {
    this.session = session
    this.record = record
    this.usual = usual
    this.now = now
    this.cut = EndOfTaskProgress.isCut(record)
  }

  print(screen: Screen): void {
    const steps = [...this.repairs(), ...this.record.checks.map((check) => this.check(check)), ...this.review()]
    const widest = (of: (step: Step) => string): number => Math.max(0, ...steps.map((step) => of(step).length))
    const [names, times] = [widest((step) => step.name), widest((step) => step.time)]
    const asked = this.asked()

    screen.line(
      `${screen.bold(`Session ${this.session.shortId}`)} (${this.session.agent}) · unit ${String(this.record.unit)} · ${this.standing()}`,
    )
    if (asked !== null) screen.hint(`Last asked: ${asked}`, 1)

    for (const step of steps)
      screen[step.mark](`${step.name.padEnd(names)}  ${step.time.padEnd(times)}  ${screen.dim(step.said)}`.trimEnd(), 1)
  }

  private standing(): string {
    const { startedAt, endedAt, outcome } = this.record
    const whole = this.usual.whole

    if (endedAt !== null) return `ended ${new LocalMoment(endedAt).text} after ${this.between(startedAt, endedAt)}: ${outcome ?? ''}`
    if (this.cut) return `stopped before its end; it started ${new LocalMoment(startedAt).text}`

    return `running for ${this.between(startedAt)}${whole === null ? '' : `, usually ${new Duration(whole).text}`}`
  }

  private repairs(): Step[] {
    return this.record.step === 'repairs' && !this.cut
      ? [{ mark: 'running', name: 'repairs', time: this.between(this.record.startedAt), said: '' }]
      : []
  }

  private check(check: CheckProgressRecord): Step {
    const { id: name } = check
    const took = check.ms === null ? '' : new Duration(check.ms).text

    if (check.status === 'waiting') return this.waiting(name, this.usual.check(name))
    if (check.status === 'running') return this.running(name, check.startedAt, this.usual.check(name))
    if (check.status === 'pass') return { mark: 'done', name, time: took, said: check.kept ? 'given again: nothing it reads changed' : '' }
    if (check.status === 'skip') return { mark: 'note', name, time: 'skipped', said: '' }

    return { mark: 'problem', name, time: took, said: check.status === 'timeout' ? 'ran out of time' : 'failed' }
  }

  private review(): Step[] {
    const review: ReviewProgressRecord | null = this.record.review

    if (review === null) return []
    if (review.status === 'waiting') return [this.waiting(REVIEW, this.usual.review)]
    if (review.status === 'running') return [this.running(REVIEW, review.startedAt, this.usual.review)]

    const [mark, said] = STANDINGS[review.standing ?? ''] ?? ['note', review.standing ?? '']
    const name = review.reviewer === null ? REVIEW : `${REVIEW} by ${review.reviewer}`
    const time =
      review.startedAt === null || review.endedAt === null || review.standing === 'none due'
        ? ''
        : this.between(review.startedAt, review.endedAt)

    return [{ mark, name, time, said }]
  }

  // A step that never started by the end is said not to have run.
  private waiting(name: string, usual: number | null): Step {
    if (this.record.endedAt !== null || this.cut) return { mark: 'note', name, time: 'not run', said: '' }

    return { mark: 'note', name, time: 'waiting', said: this.usually(usual) }
  }

  private running(name: string, startedAt: string | null, usual: number | null): Step {
    if (this.cut) return { mark: 'alert', name, time: 'stopped', said: '' }

    return { mark: 'running', name, time: startedAt === null ? '' : this.between(startedAt), said: this.usually(usual) }
  }

  private usually(ms: number | null): string {
    return ms === null ? '' : `usually ${new Duration(ms).text}`
  }

  private between(from: string, to: string | null = null): string {
    return new Duration((to === null ? this.now : Date.parse(to)) - Date.parse(from)).text
  }

  private asked(): string | null {
    const request = this.session.lastRequest?.trim().split('\n')[0] ?? ''

    if (request === '') return null

    return request.length > REQUEST_LENGTH ? `${request.slice(0, REQUEST_LENGTH)}…` : request
  }
}
