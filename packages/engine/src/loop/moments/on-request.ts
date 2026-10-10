import { OwnerRequest } from '../../unit-of-work/owner/owner-request.ts'
import { Answer } from '../exchange/answer.ts'
import type { Turn } from '../exchange/turn.ts'
import type { Moment } from './moment.ts'

export class OnRequest implements Moment {
  readonly speaksToOwner = true

  run(turn: Turn): Answer {
    const request = new OwnerRequest(turn.event.prompt ?? '')

    // A subagent's prompt is its parent's words, not the owner's.
    if (!turn.event.subagent && request.isFromOwner) turn.session()?.request(request)

    return Answer.silent()
  }
}
