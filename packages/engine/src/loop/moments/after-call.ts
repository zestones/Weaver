import { Answer } from '../exchange/answer.ts'
import { HeadAlert } from '../exchange/head-alert.ts'
import type { Turn } from '../exchange/turn.ts'
import type { Moment } from './moment.ts'

export class AfterCall implements Moment {
  readonly speaksToOwner = false

  run(turn: Turn): Answer {
    const { callId } = turn.event
    const session = callId === null ? null : turn.session()

    if (callId === null || session === null) return Answer.silent()

    return Answer.silent().after(new HeadAlert(session.closeCall(callId)).text)
  }
}
