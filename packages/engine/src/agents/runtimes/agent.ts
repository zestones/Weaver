import type { AgentEvent } from '../events/agent-event.ts'
import type { Payload } from '../events/payload.ts'

export type AgentName = 'claude' | 'codex'

export interface Agent {
  readonly name: AgentName

  read(payload: Payload): AgentEvent

  // The hook events it fires that Weaver listens to, and the tools whose calls Weaver reads.
  readonly events: readonly string[]
  readonly tools: readonly string[]
}
