import type { AgentResult } from './agent-result.ts'
import type { AgentTask } from './agent-task.ts'

// One task given to an agent, from its prompt to its last message. The agent runs without the settings of the owner
// and of the project: no hook of theirs, no extension, only what the task says. A task that fails is an answer, never
// an exception.
export interface AgentExecution {
  readonly runtime: string

  isAvailable(): boolean
  run(task: AgentTask): Promise<AgentResult>
}
