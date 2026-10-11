import { Payload } from '../../agents/events/payload.ts'
import { AgentCatalog } from '../../agents/runtimes/agent-catalog.ts'
import { CopyGuard } from '../../guards/kinds/copy-guard.ts'
import { Answer } from '../exchange/answer.ts'

// The hooks of a reviewer that Weaver started in a copy of the project. Nothing of it is followed or checked: it is
// only kept from writing outside its copy.
export class ReviewerLoop {
  private readonly agents = new AgentCatalog()
  private readonly guard: CopyGuard

  constructor(copy: string) {
    this.guard = new CopyGuard(copy)
  }

  handle(eventName: string, argv: readonly string[], stdin: string): Answer {
    if (eventName !== 'PreToolUse') return Answer.silent()

    const { call } = this.agents.fromArguments(argv).read(Payload.parse(stdin))
    const refusal = call === null ? null : this.guard.refusal(call)

    return refusal === null ? Answer.silent() : Answer.refusing(refusal.reason)
  }
}
