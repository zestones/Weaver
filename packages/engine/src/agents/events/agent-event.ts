import type { ToolCall } from '../tool-calls/tool-call.ts'

export interface AgentEventFields {
  readonly sessionId: string | null
  readonly callId: string | null
  readonly cwd: string
  readonly prompt: string | null
  readonly call: ToolCall | null
  readonly agentId: string | null
  readonly lastMessage: string | null
  readonly transcriptPath: string | null
}

export class AgentEvent {
  readonly sessionId: string | null
  readonly callId: string | null
  readonly cwd: string
  readonly prompt: string | null
  readonly call: ToolCall | null
  // The subagent that made the call. Its session is the one of its parent, so only this tells them apart.
  readonly agentId: string | null
  readonly lastMessage: string | null
  // Where the runtime writes what the session says and spends, which Weaver does not see.
  readonly transcriptPath: string | null

  constructor(fields: AgentEventFields) {
    this.sessionId = fields.sessionId
    this.callId = fields.callId
    this.cwd = fields.cwd
    this.prompt = fields.prompt
    this.call = fields.call
    this.agentId = fields.agentId
    this.lastMessage = fields.lastMessage
    this.transcriptPath = fields.transcriptPath
  }

  get subagent(): boolean {
    return this.agentId !== null
  }
}
