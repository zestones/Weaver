import { DeclarationFolder } from '../../declaration/reading/declaration-folder.ts'
import { ProjectCommandGuards } from '../../guards/deciding/project-command-guards.ts'
import { Payload } from '../../agents/events/payload.ts'
import type { ToolCall } from '../../agents/tool-calls/tool-call.ts'
import { AgentCatalog } from '../../agents/runtimes/agent-catalog.ts'
import { CopyGuard } from '../../guards/kinds/copy-guard.ts'
import { Answer } from '../exchange/answer.ts'

// The hooks of a reviewer that Weaver started. Nothing of it is followed or checked: it is kept from writing outside its
// copy, and held by the project's own command guards.
export class ReviewerLoop {
  private readonly agents = new AgentCatalog()
  private readonly guard: CopyGuard
  private readonly project: string

  constructor(copy: string, project = copy) {
    this.project = project
    this.guard = new CopyGuard(copy)
  }

  handle(eventName: string, argv: readonly string[], stdin: string): Answer {
    if (eventName !== 'PreToolUse') return Answer.silent()

    const { call } = this.agents.fromArguments(argv).read(Payload.parse(stdin))
    const reason = call === null ? null : (this.guard.refusal(call)?.reason ?? this.projectRefusal(call))

    return reason === null ? Answer.silent() : Answer.refusing(reason)
  }

  // A project whose declaration cannot be read guards nothing more: the reviewer is still kept in its copy.
  private projectRefusal(call: ToolCall): string | null {
    try {
      const declaration = DeclarationFolder.in(this.project).load()

      return declaration === null ? null : (new ProjectCommandGuards(declaration).refusal(call)?.reason ?? null)
    } catch {
      return null
    }
  }
}
