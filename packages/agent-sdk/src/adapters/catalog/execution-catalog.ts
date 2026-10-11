import type { AgentExecution } from '../../ports/agent-execution.ts'
import { ClaudeCodeExecution } from '../claude/claude-code-execution.ts'
import { CodexExecution } from '../codex/codex-execution.ts'

export class ExecutionCatalog {
  private readonly executions: readonly AgentExecution[]

  constructor(executions: readonly AgentExecution[] = [new ClaudeCodeExecution(), new CodexExecution()]) {
    this.executions = executions
  }

  find(runtime: string): AgentExecution | null {
    return this.executions.find((execution) => execution.runtime === runtime) ?? null
  }
}
