import { ProjectGuards } from '../../guards/deciding/project-guards.ts'
import { Answer } from '../exchange/answer.ts'
import type { Turn } from '../exchange/turn.ts'
import type { Moment } from './moment.ts'

export class BeforeCall implements Moment {
  readonly speaksToOwner = false

  run(turn: Turn): Answer {
    const { call, callId } = turn.event

    if (call === null) return Answer.silent()

    const refusal = new ProjectGuards(turn.declaration, turn.repo).refusal(call)

    if (refusal !== null) {
      turn.session()?.log(refusal.event(call.name))

      return Answer.refusing(refusal.reason)
    }

    const writes = call.writes(turn.repo.top, turn.declaration.commands)

    if (writes !== null && callId !== null) turn.session()?.watch(callId, { tool: call.name, ...writes, untilStop: call.background })

    return Answer.silent()
  }
}
