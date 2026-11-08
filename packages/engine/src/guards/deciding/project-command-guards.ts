import type { ToolCall } from '../../agents/tool-calls/tool-call.ts'
import type { Declaration } from '../../declaration/content/declaration.ts'
import { RunsGuard } from '../kinds/runs-guard.ts'
import type { Refusal } from '../results/refusal.ts'

export class ProjectCommandGuards {
  readonly guards: readonly RunsGuard[]

  constructor(declaration: Declaration) {
    this.guards = declaration.guards
      .filter((guard) => guard.runs.length > 0)
      .map((guard) => new RunsGuard({ id: guard.id, statement: guard.statement, liftable: true }, guard.runs))
  }

  refusal(call: ToolCall): Refusal | null {
    for (const guard of this.guards) {
      const refusal = guard.refusal(call)

      if (refusal !== null) return refusal
    }

    return null
  }
}
