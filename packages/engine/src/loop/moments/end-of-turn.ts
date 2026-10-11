import type { CheckRunner } from '../../checks/running/check-runner.ts'
import type { Declaration } from '../../declaration/content/declaration.ts'
import { ReviewLedger } from '../../review/ledger/review-ledger.ts'
import type { ReviewRounds } from '../../review/rounds/review-rounds.ts'
import { UnitDiff } from '../../unit-of-work/diff/unit-diff.ts'
import type { Session } from '../../unit-of-work/session/session.ts'
import type { UnitOfWork } from '../../unit-of-work/unit/unit-of-work.ts'
import { Report } from '../../verdict/report.ts'
import { UnitVerdict } from '../../verdict/unit-verdict.ts'
import { Answer } from '../exchange/answer.ts'
import { HeadAlert } from '../exchange/head-alert.ts'
import type { Turn } from '../exchange/turn.ts'
import type { Moment } from './moment.ts'

const PENDING = '[weaver] Checks pending: the unit of work stays open until the agent reports it finished.'

export class EndOfTurn implements Moment {
  readonly speaksToOwner = true
  private readonly checks: CheckRunner
  private readonly reviews: ReviewRounds

  constructor(checks: CheckRunner, reviews: ReviewRounds) {
    this.checks = checks
    this.reviews = reviews
  }

  async run(turn: Turn): Promise<Answer> {
    // A subagent's changes belong to its parent's unit: the parent's end of turn checks everything.
    const session = turn.event.subagent ? null : turn.session()

    if (session === null) return Answer.empty()

    const alert = new HeadAlert(session.closeOpenCalls())
    const answer = await this.finish(session, turn.declaration, turn.event.lastMessage)

    return answer.after(alert.text)
  }

  private async finish(session: Session, declaration: Declaration, lastMessage: string | null): Promise<Answer> {
    const unit = session.endTurn(lastMessage)
    const finished = declaration.finish.declaresFinished(lastMessage)

    // A turn that changed no file follows the review of the work before it, whatever its last message says: the owner
    // who writes #review is answered by the review, not by how the agent words its reply.
    if (unit.isEmpty && this.reviews.follows(session, declaration, unit)) return this.check(session, declaration, unit, lastMessage)
    if (!finished) return unit.isEmpty ? Answer.empty() : this.pending(session, declaration)
    if (!unit.isEmpty) return this.check(session, declaration, unit, lastMessage)

    // A turn that changed no file still ends its unit, so the next request starts with nothing of this one.
    if (unit.hasRequests) session.settle({})

    return Answer.empty()
  }

  private async repair(session: Session, declaration: Declaration, unit: UnitOfWork): Promise<readonly string[]> {
    if (!this.checks.repairs(declaration)) return []

    const diff = UnitDiff.of(session.repo, session.dir, unit.files, declaration.exclude)

    return session.repair(() => this.checks.repair(declaration, diff))
  }

  // The only way to speak to an agent that has stopped is to refuse its stop.
  private pending(session: Session, declaration: Declaration): Answer {
    return session.remind() ? Answer.blocking(declaration.finish.reminder()) : Answer.saying(PENDING)
  }

  private async check(session: Session, declaration: Declaration, finished: UnitOfWork, lastMessage: string | null): Promise<Answer> {
    const startedAt = Date.now()
    const repaired = finished.isEmpty ? [] : await this.repair(session, declaration, finished)
    const unit = repaired.length === 0 ? finished : session.unit()
    const diff = UnitDiff.of(session.repo, session.dir, unit.files, declaration.exclude)
    const outcomes = unit.isEmpty ? [] : await this.checks.verify(declaration, diff)
    // The reviewer judges what the checks let through: a change they refuse will be rewritten anyway.
    const blocked = outcomes.some((outcome) => outcome.blocking)
    const candidates = outcomes.flatMap((outcome) => outcome.candidates)
    const review = blocked ? null : await this.reviews.next({ session, declaration, unit, diff, lastMessage, candidates })
    const verdict = new UnitVerdict({
      unit,
      maxRounds: declaration.finish.maxRounds,
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

    if (review?.holds === true) return Answer.blocking(report.reviewRefusal(review, reportPath))
    // The review goes on by itself: the unit stays open for it, and the agent is not kept waiting.
    if (review?.standing === 'running') return Answer.saying(report.summary(reportPath))

    if (verdict.passed) {
      session.settle(unit.files)
      new ReviewLedger(session.repo).open(review?.points(session.id) ?? [])

      return Answer.saying(report.summary(reportPath))
    }

    return declaration.finish.isExhaustedAfter(session.failRound())
      ? Answer.saying(
          `[weaver] The checks still fail after ${String(declaration.finish.maxRounds)} rounds; the agent may stop. Report: ${reportPath}`,
        )
      : Answer.blocking(report.refusal(reportPath))
  }
}
