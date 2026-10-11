// timeout: no answer in the time given. runtime: the runtime refused the task or could not run it, which another try
// may get past. answer: the agent answered, but not in the shape it was asked for.
export type AgentFailure = 'timeout' | 'runtime' | 'answer'

export interface AgentResultFields {
  readonly text: string
  readonly seconds: number
  readonly answer?: unknown
  readonly failure?: string | null
  readonly failureKind?: AgentFailure | null
  readonly costUsd?: number | null
}

export class AgentResult {
  // The last message of the agent.
  readonly text: string
  readonly seconds: number
  // The last message read as the shape the task asked for; null when the task asked for none.
  readonly answer: unknown
  // Why the task did not come to an answer; null when it did.
  readonly failure: string | null
  readonly failureKind: AgentFailure | null
  // null when the runtime does not say what the task cost.
  readonly costUsd: number | null

  constructor(fields: AgentResultFields) {
    this.text = fields.text
    this.seconds = fields.seconds
    this.answer = fields.answer ?? null
    this.failure = fields.failure ?? null
    this.failureKind = this.failure === null ? null : (fields.failureKind ?? 'runtime')
    this.costUsd = fields.costUsd ?? null
  }

  get succeeded(): boolean {
    return this.failure === null
  }
}
