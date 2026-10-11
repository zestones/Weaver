import type { AgentResult } from './agent-result.ts'
import type { AgentTask } from './agent-task.ts'
import type { RuntimeHooks } from './runtime-hooks.ts'

// An agent runtime of this machine, as Weaver uses it.
export interface AgentExecution {
  readonly runtime: string

  isAvailable(): boolean

  // One task given to an agent, from its prompt to its last message. The agent runs without the settings of the owner
  // and of the project: no hook of theirs, no extension, only what the task says. A task that fails is an answer,
  // never an exception.
  run(task: AgentTask): Promise<AgentResult>

  // The hooks the runtime holds for a folder, with the owner's settings this time: what a session of theirs would
  // run there. Null when the runtime has no way to say.
  hooks(cwd: string): Promise<RuntimeHooks | null>
}
