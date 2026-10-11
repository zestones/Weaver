import { FlagBriefing } from '../../flagging/briefing/flag-briefing.ts'
import { OwnerDirectives } from '../../review/routing/owner-directives.ts'
import { OwnerRequest } from '../../unit-of-work/owner/owner-request.ts'
import { Answer } from '../exchange/answer.ts'
import type { Turn } from '../exchange/turn.ts'
import type { Moment } from './moment.ts'

export class OnRequest implements Moment {
  readonly speaksToOwner = true

  run(turn: Turn): Answer {
    const prompt = turn.event.prompt ?? ''
    const request = new OwnerRequest(prompt)
    const briefed = Answer.adding(new FlagBriefing().text)

    // A subagent's prompt is its parent's words, not the owner's.
    if (turn.event.subagent || !request.isFromOwner) return briefed

    turn.session()?.request(request)

    const mistyped = turn.declaration.review === null ? [] : new OwnerDirectives([prompt]).problems()

    return briefed.after(mistyped.length === 0 ? null : `[weaver] ${mistyped.join(' ')}`)
  }
}
