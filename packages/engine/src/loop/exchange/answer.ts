interface ToolDenial {
  readonly hookEventName: 'PreToolUse'
  readonly permissionDecision: 'deny'
  readonly permissionDecisionReason: string
}

// Both runtimes give this text to their model with the request.
interface RequestContext {
  readonly hookEventName: 'UserPromptSubmit'
  readonly additionalContext: string
}

// Both runtimes give this text to their model with the result of the call.
interface CallContext {
  readonly hookEventName: 'PostToolUse' | 'PostToolUseFailure'
  readonly additionalContext: string
}

export interface AnswerBody {
  readonly decision?: 'block'
  readonly reason?: string
  readonly systemMessage?: string
  readonly hookSpecificOutput?: ToolDenial | RequestContext | CallContext
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

  static adding(additionalContext: string): Answer {
    return new Answer({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } })
  }

  static telling(hookEventName: CallContext['hookEventName'], additionalContext: string): Answer {
    return new Answer({ hookSpecificOutput: { hookEventName, additionalContext } })
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
