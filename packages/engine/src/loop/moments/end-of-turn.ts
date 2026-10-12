import { counted } from '../../lib/text/counted.ts'
import type { WriterLauncher } from '@weaver/memory'
import type { CheckRunner } from '../../checks/running/check-runner.ts'
import type { Declaration } from '../../declaration/content/declaration.ts'
import { WriterStart } from '../../flagging/writing/writer-start.ts'
import type { Repository } from '../../lib/git/repository.ts'
import { ReviewCards } from '../../review/cards/review-cards.ts'
import type { ReviewRounds } from '../../review/rounds/review-rounds.ts'
import { AgentReviewer } from '../../review/running/agent-reviewer.ts'
import { UnitDiff } from '../../unit-of-work/diff/unit-diff.ts'
import type { EventOf } from '../../unit-of-work/journal/journal-event.ts'
import type { Session } from '../../unit-of-work/session/session.ts'
import type { UnitOfWork } from '../../unit-of-work/unit/unit-of-work.ts'
import { Report } from '../../verdict/report.ts'
import { UnitVerdict } from '../../verdict/unit-verdict.ts'
import { Answer } from '../exchange/answer.ts'
import { FlaggedNotice } from '../exchange/flagged-notice.ts'
import { HeadAlert } from '../exchange/head-alert.ts'
import { MaintenanceNotice } from '../exchange/maintenance-notice.ts'
import type { Turn } from '../exchange/turn.ts'
import type { Moment } from './moment.ts'

const PENDING = '[weaver] Checks pending: the unit of work stays open until the agent reports it finished.'

// The end of turn being answered: whose it is, the unit of work it leaves, and whether the agent said it had finished.
interface EndingTurn {
  readonly session: Session
  readonly unit: number
  readonly finished: boolean
}

export class EndOfTurn implements Moment {
  readonly speaksToOwner = true
  private readonly checks: CheckRunner
  private readonly reviews: ReviewRounds
  private readonly writers: WriterLauncher

  constructor(checks: CheckRunner, reviews: ReviewRounds, writers: WriterLauncher) {
    this.checks = checks
    this.reviews = reviews
    this.writers = writers
  }

  async run(turn: Turn): Promise<Answer> {
    // A subagent's changes belong to its parent's unit: the parent's end of turn checks everything.
    const session = turn.event.subagent ? null : turn.session()

    if (session === null) return Answer.empty()

    const alert = new HeadAlert(session.closeOpenCalls())
    // Whatever the turn ends with, its flags are written up and the owner is told of them. The writer starts before
    // the checks and the review, which a runtime may cut short: it has all the flags of the turn by now.
    const unwritten = this.startWriter(turn.repo, turn.declaration)
    const answer = await this.finish(session, turn.declaration, turn.event.lastMessage)
    const flagged = new FlaggedNotice(session.takeFlags())

    return answer.after(unwritten).after(flagged.text).after(alert.text)
  }

  // A writer runs with the hooks of a reviewer, which stay silent: it never flags and is never supervised. What
  // keeps it from starting is said to the owner, and takes nothing from the answer of the turn.
  private startWriter(repo: Repository, declaration: Declaration): string | null {
    try {
      new WriterStart(this.writers, { [AgentReviewer.MARK]: '1' }).run(repo, declaration)

      return null
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).replace(/\.$/, '')

      return `[weaver] The flags that wait were not written up: ${reason}.`
    }
  }

  private async finish(session: Session, declaration: Declaration, lastMessage: string | null): Promise<Answer> {
    const unit = session.endTurn(lastMessage)
    const finished = declaration.finish.declaresFinished(lastMessage)

    // A turn that changed no file follows the review of the work before it, whatever its last message says: the owner
    // who writes #review is answered by the review, not by how the agent words its reply.
    const turn = { session, unit: unit.number, finished }

    if (unit.isEmpty && this.reviews.follows(session, declaration, unit)) return this.check(turn, declaration, unit, lastMessage)
    if (!finished) return unit.isEmpty ? this.ended(turn, null, Answer.empty()) : this.pending(turn, declaration)
    // What maintenance let through waits for the owner in a report, even when no file changed.
    if (!unit.isEmpty || unit.lifted.length > 0) return this.check(turn, declaration, unit, lastMessage)
    if (!unit.hasRequests) return this.ended(turn, null, Answer.empty())

    // A turn that changed no file still ends its unit, so the next request starts with nothing of this one.
    session.settle({})

    return this.ended(turn, null, this.over(session, Answer.empty()))
  }

  // Each end of turn is kept, with what held the agent back if anything did.
  private ended(turn: EndingTurn, held: EventOf<'turn'>['held'], answer: Answer): Answer {
    turn.session.log({ kind: 'turn', unit: turn.unit, finished: turn.finished, held })

    return answer
  }

  // The owner is the one who closes maintenance: they are reminded of it when a task ends, and nothing more.
  private over(session: Session, answer: Answer): Answer {
    return answer.before(new MaintenanceNotice(session).reminder)
  }

  private async repair(session: Session, declaration: Declaration, unit: UnitOfWork, deadline: number): Promise<readonly string[]> {
    if (!this.checks.repairs(declaration)) return []

    const diff = UnitDiff.of(session.repo, session.dir, unit.files, declaration.exclude)

    return session.repair(() => this.checks.repair(declaration, diff, deadline))
  }

  // The only way to speak to an agent that has stopped is to refuse its stop.
  private pending(turn: EndingTurn, declaration: Declaration): Answer {
    return turn.session.remind()
      ? this.ended(turn, 'reminder', Answer.blocking(declaration.finish.reminder()))
      : this.ended(turn, null, Answer.saying(PENDING))
  }

  private async check(turn: EndingTurn, declaration: Declaration, finished: UnitOfWork, lastMessage: string | null): Promise<Answer> {
    const { session } = turn
    const startedAt = Date.now()
    const deadline = declaration.checkLimits.deadlineFrom(startedAt)
    const repaired = finished.isEmpty ? [] : await this.repair(session, declaration, finished, deadline)
    const unit = repaired.length === 0 ? finished : session.unit()
    const diff = UnitDiff.of(session.repo, session.dir, unit.files, declaration.exclude)
    const outcomes = unit.isEmpty ? [] : await this.checks.judge(declaration, diff, deadline)
    // The reviewer judges what the checks let through: a change they refuse will be rewritten anyway.
    const blocked = outcomes.some((outcome) => outcome.blocking)
    const candidates = outcomes.flatMap((outcome) => outcome.candidates)
    const review = blocked ? null : await this.reviews.next({ session, declaration, unit, diff, lastMessage, candidates })
    const verdict = new UnitVerdict({
      unit,
      maxRefusals: declaration.checkLimits.maxRefusals,
      diff,
      outcomes,
      repaired,
      review,
      ms: Date.now() - startedAt,
    })
    const report = new Report(declaration, verdict)
    const reportPath = report.write(session.dir)

    if (!unit.isEmpty) session.log(verdict.event())

    for (const event of review?.events(unit.number) ?? []) session.log(event)

    if (review?.holds === true) return this.ended(turn, 'review', Answer.blocking(report.reviewRefusal(review, reportPath)))
    // The review goes on by itself: the unit stays open for it, and the agent is not kept waiting.
    if (review?.standing === 'running') return this.ended(turn, null, Answer.saying(report.summary(reportPath)))

    if (verdict.passed) {
      session.settle(unit.files)
      if (review !== null) new ReviewCards(session.repo).open(review, session, unit, declaration)

      return this.ended(turn, null, this.over(session, Answer.saying(report.summary(reportPath))))
    }

    if (!declaration.checkLimits.isExhaustedAfter(session.failRound())) {
      return this.ended(turn, 'checks', Answer.blocking(report.refusal(reportPath)))
    }

    const given = `[weaver] The checks still fail after ${counted(declaration.checkLimits.maxRefusals, 'refusal')}; the agent may stop. Report: ${reportPath}`

    return this.ended(turn, null, this.over(session, Answer.saying(given)))
  }
}
