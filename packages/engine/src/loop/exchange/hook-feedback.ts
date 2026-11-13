import type { EventSource } from '../../unit-of-work/journal/journal-event.ts'
import type { Journal } from '../../unit-of-work/journal/journal.ts'
import { Answer } from './answer.ts'

const TEN_MINUTES = 10 * 60 * 1000

export class HookFeedback {
  private readonly journal: Journal
  private readonly source: EventSource

  constructor(journal: Journal, source: EventSource) {
    this.journal = journal
    this.source = source
  }

  failure(event: string, reason: string, answer = Answer.silent()): Answer {
    this.keep({ kind: 'error', event, message: reason })

    return this.tell(event, event, reason, answer)
  }

  notice(event: string, message: string | null, answer: Answer): Answer {
    if (message === null) return answer

    for (const channel of event === 'Stop' ? (['owner'] as const) : (['owner', 'agent'] as const)) {
      try {
        if (!this.journal.notify(this.source, { kind: 'notification', event: 'declaration-format', message, channel }, null)) continue
      } catch {
        // A notice must not interrupt supervision when its receipt cannot be written.
      }
      answer = channel === 'owner' ? answer.before(`[weaver] ${message}`) : answer.context(event, `[weaver] ${message}`)
    }

    return answer
  }

  // A failed end of task is told to the agent at its next request or call: the Stop hook has no channel to it.
  pending(event: string, answer: Answer): Answer {
    if (event !== 'UserPromptSubmit' && event !== 'PostToolUse') return answer

    const failure = this.untoldStopFailure()

    return failure === null ? answer : this.tell(event, 'Stop', failure, answer)
  }

  private tell(delivery: string, event: string, reason: string, answer: Answer): Answer {
    const channel = delivery === 'Stop' ? 'owner' : 'agent'
    const message = reason.replace(/\s+/g, ' ').slice(0, 300)
    const since = new Date(Date.now() - TEN_MINUTES).toISOString()
    try {
      if (!this.journal.notify(this.source, { kind: 'notification', event, message, channel }, since)) return answer
    } catch {
      // The journal may be the failure being reported; it must not prevent feedback.
    }

    const what = event === 'Stop' ? 'The end of the task failed' : `The ${event} hook failed`

    return answer.context(
      delivery,
      `[weaver] ${what}; supervision may be incomplete. Tell the owner and run weaver doctor. Error: ${message}. Journal: ${this.journal.dir}`,
    )
  }

  private untoldStopFailure(): string | null {
    try {
      return this.journal.untoldStopFailure(this.source.session)
    } catch {
      return null
    }
  }

  private keep(body: Parameters<Journal['append']>[1]): void {
    try {
      this.journal.append(this.source, body)
    } catch {
      // Feedback still reaches the runtime when the journal itself cannot be written.
    }
  }
}
