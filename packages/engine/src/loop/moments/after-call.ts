import type { CheckRunner } from '../../checks/running/check-runner.ts'
import type { Declaration } from '../../declaration/content/declaration.ts'
import { CallDiff } from '../../unit-of-work/diff/call-diff.ts'
import type { Session } from '../../unit-of-work/session/session.ts'
import { CallWarning } from '../../verdict/call-warning.ts'
import { Answer } from '../exchange/answer.ts'
import { HeadAlert } from '../exchange/head-alert.ts'
import type { Turn } from '../exchange/turn.ts'
import type { Moment } from './moment.ts'

type CallEvent = 'PostToolUse' | 'PostToolUseFailure'

export class AfterCall implements Moment {
  readonly speaksToOwner = false
  private readonly event: CallEvent
  private readonly checks: CheckRunner

  constructor(event: CallEvent, checks: CheckRunner) {
    this.event = event
    this.checks = checks
  }

  // A project whose checks do not warn is answered at once.
  run(turn: Turn): Answer | Promise<Answer> {
    const { callId } = turn.event
    const session = callId === null ? null : turn.session()

    if (callId === null || session === null) return Answer.silent()

    const touches = session.closeCall(callId)
    const alert = new HeadAlert(touches).text
    const changes = new Map(touches.flatMap((touch) => [...touch.changes]))
    const call = CallDiff.of(session.repo, session.dir, callId, changes, turn.declaration.exclude)

    if (call.isEmpty || !this.checks.warns(turn.declaration)) return Answer.silent().after(alert)

    return this.warning(session, turn.declaration, call, turn.event.call?.name ?? '').then((warning) =>
      (warning === null ? Answer.silent() : Answer.telling(this.event, warning)).after(alert),
    )
  }

  // What the checks that warn found on what the call changed. The agent is told and not held: the edit is made, and
  // the verdict comes at the end of the task.
  private async warning(session: Session, declaration: Declaration, call: CallDiff, tool: string): Promise<string | null> {
    const startedAt = Date.now()
    const outcomes = await this.checks.warn(declaration, call, declaration.checkLimits.warnDeadlineFrom(startedAt))

    if (outcomes.length > 0) {
      session.log({
        kind: 'warn',
        tool,
        files: call.files.length,
        ms: Date.now() - startedAt,
        checks: outcomes.map((outcome) => outcome.run),
        warned: outcomes.filter((outcome) => outcome.blocking).map((outcome) => outcome.id),
      })
    }

    return new CallWarning(declaration, outcomes).text
  }
}
