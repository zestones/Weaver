import type { ToolCall } from '../tool-calls/tool-call.ts'

export interface AgentEventFields {
  readonly sessionId: string | null
  readonly callId: string | null
  readonly cwd: string
  readonly prompt: string | null
  readonly call: ToolCall | null
  readonly subagent: boolean
  readonly lastMessage: string | null
}

export class AgentEvent {
  readonly sessionId: string | null
  readonly callId: string | null
  readonly cwd: string
  readonly prompt: string | null
  readonly call: ToolCall | null
  readonly subagent: boolean
  readonly lastMessage: string | null

  constructor(fields: AgentEventFields) {
    this.sessionId = fields.sessionId
    this.callId = fields.callId
    this.cwd = fields.cwd
    this.prompt = fields.prompt
    this.call = fields.call
    this.subagent = fields.subagent
    this.lastMessage = fields.lastMessage
  }
}
