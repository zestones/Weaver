import type { CheckRunner } from '../../checks/running/check-runner.ts'
import type { Declaration } from '../../declaration/content/declaration.ts'
import { WaitingCards } from '../../noting/cards/waiting-cards.ts'
import { CallDiff } from '../../unit-of-work/diff/call-diff.ts'
import type { Session } from '../../unit-of-work/session/session.ts'
import { CallWarning } from '../../verdict/call-warning.ts'
import { Answer } from '../exchange/answer.ts'
import { CardNotice } from '../exchange/card-notice.ts'
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

    const { background } = turn.event

    // Only the agent itself is told of the end of its tasks: a subagent's are its own.
    if (background !== null && !turn.event.subagent) session.startedInBackground(background.id, background.timeoutMs, callId)

    const touches = session.closeCall(callId)
    const alert = new HeadAlert(touches).text
    // The agent is told of what its call changed, not of what another call of the session wrote meanwhile.
    const own = new Map(touches.flatMap((touch) => [...touch.own]))
    const changes = session.unit().sinceBase(own)
    const call = CallDiff.of(session.repo, session.dir, callId, changes, turn.declaration.exclude)
    const notice = this.cardNotice(session, [...own.keys()])

    // A moved HEAD is the agent's to hear as much as the owner's: a commit it made settles nothing.
    if (call.isEmpty || !this.checks.warns(turn.declaration)) return this.told([notice, alert]).after(alert)

    return this.warning(session, turn.declaration, call, turn.event.call?.name ?? '').then((warning) =>
      this.told([warning, notice, alert]).after(alert),
    )
  }

  private told(texts: readonly (string | null)[]): Answer {
    const said = texts.flatMap((text) => (text === null ? [] : [text]))

    return said.length === 0 ? Answer.silent() : Answer.telling(this.event, said.join('\n\n'))
  }

  // The agent is told once of each card whose files its calls change. Cards are a help: failing to read them never
  // changes the answer to the call.
  private cardNotice(session: Session, changed: readonly string[]): string | null {
    if (changed.length === 0) return null

    try {
      const cards = new WaitingCards(session.repo).naming(changed)
      const told = cards.length === 0 ? [] : session.concerned(cards.map((card) => card.number))

      return new CardNotice(
        cards.filter((card) => told.includes(card.number)),
        changed,
      ).text
    } catch {
      return null
    }
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
