import type { AgentExecution } from '../ports/agent-execution.ts'
import { AgentResult } from '../ports/agent-result.ts'
import type { AgentTask } from '../ports/agent-task.ts'
import type { RuntimeHooks } from '../ports/runtime-hooks.ts'

// Stands for an agent in a test: it gives the answers it was handed, in order, and keeps the tasks it was given. Of
// the hooks of a folder it says what it was handed, and nothing by default.
export class ScriptedExecution implements AgentExecution {
  readonly runtime: string
  readonly tasks: AgentTask[] = []
  private readonly answers: AgentResult[]
  private readonly held: RuntimeHooks | null

  constructor(runtime: string, answers: readonly AgentResult[], held: RuntimeHooks | null = null) {
    this.runtime = runtime
    this.answers = [...answers]
    this.held = held
  }

  isAvailable(): boolean {
    return true
  }

  run(task: AgentTask): Promise<AgentResult> {
    this.tasks.push(task)

    return Promise.resolve(this.answers.shift() ?? new AgentResult({ text: '', seconds: 0, failure: 'no scripted answer is left' }))
  }

  hooks(): Promise<RuntimeHooks | null> {
    return Promise.resolve(this.held)
  }
}
