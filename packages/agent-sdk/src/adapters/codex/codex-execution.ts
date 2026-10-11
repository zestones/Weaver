import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { withScratch } from '../../lib/files/scratch.ts'
import { runProcess, starts, TIMED_OUT } from '../../lib/process/process.ts'
import { isRecord, parseJson } from '../../lib/text/json.ts'
import type { AgentExecution } from '../../ports/agent-execution.ts'
import { AgentResult } from '../../ports/agent-result.ts'
import type { AgentTask } from '../../ports/agent-task.ts'
import type { RuntimeHooks } from '../../ports/runtime-hooks.ts'
import { CodexHooks } from './codex-hooks.ts'

type CodexEvent = Readonly<Record<string, unknown>>

// The sandbox of this runtime keeps the writes of a task inside its working directory; the network stays open, so
// that the task can reach what runs on the machine.
const SANDBOX = {
  'read-only': ['-s', 'read-only'],
  write: ['-s', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true', '-c', 'approval_policy="never"'],
}
const UNSHAPED = 'the agent did not give its answer in the shape it was asked for'

export class CodexExecution implements AgentExecution {
  readonly runtime = 'codex'
  private readonly binary: string

  constructor(binary = 'codex') {
    this.binary = binary
  }

  isAvailable(): boolean {
    return starts(this.binary)
  }

  run(task: AgentTask): Promise<AgentResult> {
    return withScratch((scratch) => this.ask(task, scratch))
  }

  hooks(cwd: string): Promise<RuntimeHooks> {
    return new CodexHooks(this.binary).of(cwd)
  }

  private async ask(task: AgentTask, scratch: string): Promise<AgentResult> {
    const result = await runProcess(this.binary, this.args(task, scratch), {
      cwd: task.cwd,
      timeoutMs: task.timeoutSeconds * 1000,
      env: { ...process.env, ...task.environment },
      input: task.prompt,
    })
    const seconds = result.ms / 1000

    if (result.code === TIMED_OUT)
      return new AgentResult({ text: '', seconds, failure: `no answer after ${String(task.timeoutSeconds)} s`, failureKind: 'timeout' })

    const events = this.events(result.stdout)
    const text = events.flatMap((event) => this.message(event)).at(-1)
    const failure = this.failure(events) ?? (result.code === 0 ? null : `codex exited with ${String(result.code)}: ${result.output.trim()}`)

    if (failure !== null || text === undefined)
      return new AgentResult({ text: text ?? '', seconds, failure: failure ?? 'codex gave no message' })
    if (task.answerSchema === null) return new AgentResult({ text, seconds })

    const answer = parseJson(text)

    return new AgentResult({ text, seconds, answer, failure: answer === undefined ? UNSHAPED : null, failureKind: 'answer' })
  }

  // The prompt is read on the standard input, and the shape of the answer from a file. A task is asked once and never
  // resumed, so it leaves no session behind among the owner's.
  private args(task: AgentTask, scratch: string): string[] {
    const model = task.model === null ? [] : ['-m', task.model]
    const effort = task.effort === null ? [] : ['-c', `model_reasoning_effort="${task.effort}"`]

    return [
      'exec',
      '--json',
      '--ephemeral',
      '--ignore-user-config',
      ...SANDBOX[task.access],
      ...model,
      ...effort,
      ...this.schema(task, scratch),
      '-',
    ]
  }

  private schema(task: AgentTask, scratch: string): string[] {
    if (task.answerSchema === null) return []

    const path = join(scratch, 'answer.schema.json')

    writeFileSync(path, JSON.stringify(task.answerSchema))

    return ['--output-schema', path]
  }

  // One event a line; a line that is not an event is something the runtime printed on the way.
  private events(stdout: string): CodexEvent[] {
    return stdout.split('\n').flatMap((line) => {
      const parsed = parseJson(line)

      return isRecord(parsed) ? [parsed] : []
    })
  }

  private message(event: CodexEvent): string[] {
    const { item } = event

    return isRecord(item) && item.type === 'agent_message' && typeof item.text === 'string' ? [item.text] : []
  }

  private failure(events: readonly CodexEvent[]): string | null {
    const failed = events.find((event) => event.type === 'turn.failed' || event.type === 'error')

    if (failed === undefined) return null

    const message = isRecord(failed.error) ? failed.error.message : failed.message

    return typeof message === 'string' ? message : 'codex reported a failure without a message'
  }
}
