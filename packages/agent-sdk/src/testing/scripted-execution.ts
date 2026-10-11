import type { AgentExecution } from '../ports/agent-execution.ts'
import { AgentResult } from '../ports/agent-result.ts'
import type { AgentTask } from '../ports/agent-task.ts'

// Stands for an agent in a test: it gives the answers it was handed, in order, and keeps the tasks it was given.
export class ScriptedExecution implements AgentExecution {
  readonly runtime: string
  readonly tasks: AgentTask[] = []
  private readonly answers: AgentResult[]

  constructor(runtime: string, answers: readonly AgentResult[]) {
    this.runtime = runtime
    this.answers = [...answers]
  }

  isAvailable(): boolean {
    return true
  }

  run(task: AgentTask): Promise<AgentResult> {
    this.tasks.push(task)

    return Promise.resolve(this.answers.shift() ?? new AgentResult({ text: '', seconds: 0, failure: 'no scripted answer is left' }))
  }
}
