import { Report } from '../../checks/results/report.ts'
import { UnitVerdict } from '../../checks/results/unit-verdict.ts'
import type { CheckRunner } from '../../checks/running/check-runner.ts'
import type { Declaration } from '../../declaration/content/declaration.ts'
import { UnitDiff } from '../../unit-of-work/diff/unit-diff.ts'
import type { Session } from '../../unit-of-work/session/session.ts'
import type { UnitOfWork } from '../../unit-of-work/unit/unit-of-work.ts'
import { Answer } from '../exchange/answer.ts'
import { HeadAlert } from '../exchange/head-alert.ts'
import type { Turn } from '../exchange/turn.ts'
import type { Moment } from './moment.ts'

const PENDING = '[weaver] Checks pending: the unit of work stays open until the agent reports it finished.'

export class EndOfTurn implements Moment {
  readonly speaksToOwner = true
  private readonly checks: CheckRunner

  constructor(checks: CheckRunner) {
    this.checks = checks
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

    if (!declaration.finish.declaresFinished(lastMessage)) return unit.isEmpty ? Answer.empty() : this.pending(session, declaration)
    if (!unit.isEmpty) return this.check(session, declaration, unit)

    // A turn that changed no file still ends its unit, so the next request starts with nothing of this one.
    if (unit.hasRequests) session.settle({})

    return Answer.empty()
  }

  // The only way to speak to an agent that has stopped is to refuse its stop.
  private pending(session: Session, declaration: Declaration): Answer {
    return session.remind() ? Answer.blocking(declaration.finish.reminder()) : Answer.saying(PENDING)
  }

  private async check(session: Session, declaration: Declaration, unit: UnitOfWork): Promise<Answer> {
    const diff = UnitDiff.of(session.repo, session.dir, unit.files, declaration.exclude)
    const startedAt = Date.now()
    const outcomes = await this.checks.run(declaration, diff)
    const verdict = new UnitVerdict({ unit, maxRounds: declaration.finish.maxRounds, diff, outcomes, ms: Date.now() - startedAt })
    const report = new Report(declaration, verdict)
    const reportPath = report.write(session.dir)

    session.log(verdict.event())

    if (verdict.passed) {
      session.settle(unit.files)

      return Answer.saying(report.summary(reportPath))
    }

    return declaration.finish.isExhaustedAfter(session.failRound())
      ? Answer.saying(
          `[weaver] The checks still fail after ${String(declaration.finish.maxRounds)} rounds; the agent may stop. Report: ${reportPath}`,
        )
      : Answer.blocking(report.refusal(reportPath))
  }
}
