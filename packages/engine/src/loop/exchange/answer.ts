interface ToolDenial {
  readonly hookEventName: 'PreToolUse'
  readonly permissionDecision: 'deny'
  readonly permissionDecisionReason: string
}

export interface AnswerBody {
  readonly decision?: 'block'
  readonly reason?: string
  readonly systemMessage?: string
  readonly hookSpecificOutput?: ToolDenial
}

export class Answer {
  readonly body: AnswerBody | null

  constructor(body: AnswerBody | null) {
    this.body = body
  }

  static silent(): Answer {
    return new Answer(null)
  }

  // An answer that decides nothing, for the event whose runtime expects one all the same.
  static empty(): Answer {
    return new Answer({})
  }

  static saying(systemMessage: string): Answer {
    return new Answer({ systemMessage })
  }

  static blocking(reason: string): Answer {
    return new Answer({ decision: 'block', reason })
  }

  static refusing(reason: string): Answer {
    return new Answer({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })
  }

  after(alert: string | null): Answer {
    if (alert === null) return this

    const said = this.body?.systemMessage

    return new Answer({ ...this.body, systemMessage: said === undefined ? alert : `${alert} ${said}` })
  }

  print(): string {
    return this.body === null ? '' : JSON.stringify(this.body)
  }
}
