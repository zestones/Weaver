import { CardRegistry } from '@weaver/memory'
import { FlagCall } from '../../flagging/calls/flag-call.ts'
import { FlagRecorder, type FlagAnswer } from '../../flagging/recording/flag-recorder.ts'
import { ProjectGuards } from '../../guards/deciding/project-guards.ts'
import { UnitLines } from '../../unit-of-work/diff/unit-lines.ts'
import type { Session } from '../../unit-of-work/session/session.ts'
import { Answer } from '../exchange/answer.ts'
import type { Turn } from '../exchange/turn.ts'
import type { Moment } from './moment.ts'

export class BeforeCall implements Moment {
  readonly speaksToOwner = false

  run(turn: Turn): Answer {
    const { call, callId } = turn.event

    if (call === null) return Answer.silent()

    const flag = FlagCall.in(call)

    // A flag is answered here in place of its command, so no guard has a call to judge.
    if (flag !== null) return Answer.refusing(this.flagged(turn, flag))

    const refusal = new ProjectGuards(turn.declaration, turn.repo).refusal(call)

    if (refusal !== null) {
      turn.session()?.log(refusal.event(call.name))

      return Answer.refusing(refusal.reason)
    }

    const writes = call.writes(turn.repo.top, turn.declaration.scripts)

    if (writes !== null && callId !== null) turn.session()?.watch(callId, { tool: call.name, ...writes, untilStop: call.background })

    return Answer.silent()
  }

  // A hook that fails lets its call through: the command would then run, and the agent would take its flag for made.
  private flagged(turn: Turn, flag: FlagCall): string {
    try {
      const session = turn.session()
      const answer = this.recorded(turn, flag, session)

      if (answer.card !== null) session?.flagged(answer.card.number, answer.known)

      return answer.message
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)).replace(/\.$/, '')

      return `[weaver] The flag was not recorded, because Weaver failed: ${reason}. This command is answered here and never runs. Say what you wanted to flag in your final message, for the owner, and go on with your task.`
    }
  }

  // The author is never declared by the agent: the runtime says who calls.
  private recorded(turn: Turn, flag: FlagCall, session: Session | null): FlagAnswer {
    const { event, repo } = turn
    const unit = session?.unit() ?? null
    const lines = session === null || unit === null ? null : new UnitLines(session, unit)
    const registry = new CardRegistry(repo.stateDir)

    try {
      return new FlagRecorder(repo, registry).record(
        { callId: event.callId, places: flag.places, body: flag.body ?? '', cwd: flag.cwd ?? event.cwd },
        {
          author: turn.agent.name,
          role: 'author',
          session: session?.id ?? null,
          subagent: event.agentId,
          unit: unit?.number ?? null,
          requests: unit?.requests ?? [],
          written: (file) => lines?.of(file) ?? null,
        },
      )
    } finally {
      registry.close()
    }
  }
}
