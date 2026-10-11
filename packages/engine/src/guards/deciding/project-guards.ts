import type { ToolCall } from '../../agents/tool-calls/tool-call.ts'
import type { Declaration } from '../../declaration/content/declaration.ts'
import type { DeclaredGuard } from '../../declaration/content/declared-guard.ts'
import type { Repository } from '../../lib/git/repository.ts'
import { EngineGuard } from '../kinds/engine-guard.ts'
import type { Guard } from '../kinds/guard.ts'
import { RunsGuard } from '../kinds/runs-guard.ts'
import { WritesGuard } from '../kinds/writes-guard.ts'
import type { Refusal } from '../results/refusal.ts'

export class ProjectGuards {
  private readonly guards: readonly Guard[]

  constructor(declaration: Declaration, repo: Repository) {
    this.guards = [new EngineGuard(repo, declaration.skills), ...declaration.guards.flatMap((declared) => this.guardsOf(declared, repo))]
  }

  refusal(call: ToolCall): Refusal | null {
    for (const guard of this.guards) {
      const refusal = guard.refusal(call)

      if (refusal !== null) return refusal
    }

    return null
  }

  private guardsOf(declared: DeclaredGuard, repo: Repository): Guard[] {
    const fields = { id: declared.id, statement: declared.statement }

    return [
      ...(declared.writes.length > 0 ? [new WritesGuard(fields, repo.top, declared.writes)] : []),
      ...(declared.runs.length > 0 ? [new RunsGuard(fields, declared.runs)] : []),
    ]
  }
}
