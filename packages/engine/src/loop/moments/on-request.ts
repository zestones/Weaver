import { TaskNotification } from '../../agents/events/task-notification.ts'
import { RequestBriefing } from '../../guidance/briefing/request-briefing.ts'
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
    const told = [new RequestBriefing(turn.declaration).text, new MaintenanceNotice(session).briefing]
    const briefed = Answer.adding(told.flatMap((text) => (text === null ? [] : [text])).join('\n\n'))
    const ended = new TaskNotification(prompt).ended

    if (ended !== null && !turn.event.subagent) session?.endedInBackground(ended)

    // A subagent starts with nothing of its parent, and is briefed for its own work. What the runtime says between two
    // requests, such as the end of a task, starts no work: it is not briefed again.
    if (turn.event.subagent) return briefed
    if (!request.isFromOwner) return Answer.silent()

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
