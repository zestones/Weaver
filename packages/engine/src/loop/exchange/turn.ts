import type { AgentEvent } from '../../agents/events/agent-event.ts'
import type { Agent } from '../../agents/runtimes/agent.ts'
import type { Declaration } from '../../declaration/content/declaration.ts'
import type { Repository } from '../../lib/git/repository.ts'
import { Session } from '../../unit-of-work/session/session.ts'

export class Turn {
  readonly agent: Agent
  readonly event: AgentEvent
  readonly repo: Repository
  readonly declaration: Declaration

  constructor(agent: Agent, event: AgentEvent, repo: Repository, declaration: Declaration) {
    this.agent = agent
    this.event = event
    this.repo = repo
    this.declaration = declaration
  }

  session(): Session | null {
    const { sessionId, transcriptPath } = this.event

    return sessionId === null ? null : Session.met(this.repo, sessionId, this.agent.name, transcriptPath)
  }
}
