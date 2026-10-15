import { FlagBriefing } from '../../flagging/briefing/flag-briefing.ts'
import { ReviewStore } from '../../review/results/review-store.ts'
import { OwnerDirectives } from '../../review/routing/owner-directives.ts'
import { OwnerRequest } from '../../unit-of-work/owner/owner-request.ts'
import { Answer } from '../exchange/answer.ts'
import { MaintenanceNotice } from '../exchange/maintenance-notice.ts'
import type { Turn } from '../exchange/turn.ts'
import type { Moment } from './moment.ts'

export class OnRequest implements Moment {
  readonly speaksToOwner = true

  run(turn: Turn): Answer {
    const prompt = turn.event.prompt ?? ''
    const request = new OwnerRequest(prompt)
    const session = turn.session()
    const maintenance = new MaintenanceNotice(session).briefing
    const briefed = Answer.adding([new FlagBriefing().text, ...(maintenance === null ? [] : [maintenance])].join('\n\n'))

    // A subagent's prompt is its parent's words, not the owner's.
    if (turn.event.subagent || !request.isFromOwner) return briefed

    const directives = new OwnerDirectives([prompt])

    // A message sent while an end of turn waits for a review takes the turn from it: the review goes on.
    if (session !== null) new ReviewStore(session.dir).releaseAll()

    session?.log({
      kind: 'request',
      unit: session.request(request),
      text: request.kept,
      directives: directives.given,
      transcript: turn.event.transcriptPath,
    })

    const mistyped = turn.declaration.review === null ? [] : directives.problems()

    return briefed.after(mistyped.length === 0 ? null : `[weaver] ${mistyped.join(' ')}`)
  }
}
