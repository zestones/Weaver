import type { CheckProgress, Progress } from '../types'
import { Duration } from './duration.ts'

export type Mark = 'done' | 'problem' | 'alert' | 'note' | 'running'

// A step of the end of a task: how it stands, how long it took or has run, and what else is to know of it.
export type Step = { mark: Mark; name: string; time: string; said: string }

const WEAVER = 'Weaver ·'
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

// What the chat says of an end of task of Weaver, from the progress Weaver keeps of it: a line in place of the spinner's,
// a line a step above the prompt, and a line once it is over.
export class EndOfTaskView {
  private readonly progress: Progress
  private readonly now: number

  constructor(progress: Progress, now: number) {
    this.progress = progress
    this.now = now
  }

  // The step under way, how long it has run and how long it usually takes.
  get doing(): string {
    const { step, checks, review, outcome } = this.progress

    if (step === 'over') return `${WEAVER} ${outcome ?? ''}`
    if (step === 'repairs') return `${WEAVER} repairs`
    if (step === 'review' && review !== null) return `${WEAVER} review ${this.since(review.startedAt, review.usualMs)}`

    const running = checks.filter((check) => check.status === 'running')
    const [only] = running
    const done = checks.filter((check) => check.status !== 'waiting' && check.status !== 'running').length
    const what =
      only === undefined
        ? 'checks'
        : running.length === 1
          ? `${only.id} ${this.since(only.startedAt, only.usualMs)}`
          : running.map((check) => check.id).join(', ')

    return `${WEAVER} ${what} · ${String(done)} of ${String(checks.length)} checks done`
  }

  get heading(): string {
    const { unit, startedAt, usualMs } = this.progress

    return `${WEAVER} end of task, unit ${String(unit)} · ${this.since(startedAt, usualMs)}`
  }

  get steps(): Step[] {
    const { checks, review } = this.progress

    if (review === null) return checks.map((check) => this.check(check))
    if (review.status === 'waiting') return [...checks.map((check) => this.check(check)), this.waiting(REVIEW, review.usualMs)]
    if (review.status === 'running')
      return [...checks.map((check) => this.check(check)), this.running(REVIEW, review.startedAt, review.usualMs)]

    const [mark, said] = STANDINGS[review.standing ?? ''] ?? ['note', review.standing ?? '']
    const name = review.reviewer === null ? REVIEW : `${REVIEW} by ${review.reviewer}`
    const time =
      review.startedAt === null || review.endedAt === null || review.standing === 'none due'
        ? ''
        : this.between(review.startedAt, review.endedAt)

    return [...checks.map((check) => this.check(check)), { mark, name, time, said }]
  }

  // How long the end of task took, once it is over; null while it runs.
  get took(): number | null {
    const { startedAt, endedAt } = this.progress

    return endedAt === null ? null : Date.parse(endedAt) - Date.parse(startedAt)
  }

  get ended(): string {
    return `Weaver: ${this.progress.outcome ?? 'over'}, after ${new Duration(this.took ?? 0).text}`
  }

  private check(check: CheckProgress): Step {
    const { id: name } = check
    const took = check.ms === null ? '' : new Duration(check.ms).text

    if (check.status === 'waiting') return this.waiting(name, check.usualMs)
    if (check.status === 'running') return this.running(name, check.startedAt, check.usualMs)
    if (check.status === 'pass') return { mark: 'done', name, time: took, said: check.kept ? 'given again: nothing it reads changed' : '' }
    if (check.status === 'skip') return { mark: 'note', name, time: 'skipped', said: '' }

    return { mark: 'problem', name, time: took, said: check.status === 'timeout' ? 'ran out of time' : 'failed' }
  }

  // A step that never started by the end is said not to have run.
  private waiting(name: string, usual: number | null): Step {
    if (this.progress.endedAt !== null) return { mark: 'note', name, time: 'not run', said: '' }

    return { mark: 'note', name, time: 'waiting', said: this.usually(usual) }
  }

  private running(name: string, startedAt: string | null, usual: number | null): Step {
    return { mark: 'running', name, time: startedAt === null ? '' : this.between(startedAt), said: this.usually(usual) }
  }

  private since(startedAt: string | null, usual: number | null): string {
    const ran = startedAt === null ? '' : this.between(startedAt)
    const usually = this.usually(usual)

    return usually === '' ? ran : `${ran}, ${usually}`
  }

  // Weaver 0.9.4 kept no usual time.
  private usually(ms: number | null): string {
    return typeof ms === 'number' ? `usually ${new Duration(ms).text}` : ''
  }

  private between(from: string, to: string | null = null): string {
    return new Duration((to === null ? this.now : Date.parse(to)) - Date.parse(from)).text
  }
}
