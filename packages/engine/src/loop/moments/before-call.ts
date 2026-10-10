import { Answer } from '../exchange/answer.ts'
import type { Turn } from '../exchange/turn.ts'
import type { Moment } from './moment.ts'

export class BeforeCall implements Moment {
  readonly speaksToOwner = false

  run(turn: Turn): Answer {
    const { call, callId } = turn.event
    const writes = call?.writes(turn.repo.top, turn.declaration.commands) ?? null

    if (call === null || writes === null || callId === null) return Answer.silent()

    turn.session()?.watch(callId, { tool: call.name, ...writes, untilStop: call.background })

    return Answer.silent()
  }
}
