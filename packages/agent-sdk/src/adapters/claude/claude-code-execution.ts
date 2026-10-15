import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { withScratch } from '../../lib/files/scratch.ts'
import { runProcess, starts, STOPPED, TIMED_OUT } from '../../lib/process/process.ts'
import { isRecord, parseJson } from '../../lib/text/json.ts'
import type { AgentExecution } from '../../ports/agent-execution.ts'
import { AgentResult } from '../../ports/agent-result.ts'
import type { AgentTask } from '../../ports/agent-task.ts'

const READING_TOOLS = ['Read', 'Grep', 'Glob']
const GUARD_TIMEOUT_SECONDS = 10
const UNSHAPED = 'the agent did not give its answer in the shape it was asked for'

export class ClaudeCodeExecution implements AgentExecution {
  readonly runtime = 'claude'
  private readonly binary: string

  constructor(binary = 'claude') {
    this.binary = binary
  }

  isAvailable(): boolean {
    return starts(this.binary)
  }

  run(task: AgentTask): Promise<AgentResult> {
    return withScratch((scratch) => this.ask(task, scratch))
  }

  hooks(): Promise<null> {
    return Promise.resolve(null)
  }

  private async ask(task: AgentTask, scratch: string): Promise<AgentResult> {
    const result = await runProcess(this.binary, this.args(task, scratch), {
      cwd: task.cwd,
      timeoutMs: task.timeoutSeconds * 1000,
      env: { ...process.env, ...task.environment },
      input: task.prompt,
      signal: task.signal,
    })
    const seconds = result.ms / 1000

    if (result.code === TIMED_OUT)
      return new AgentResult({ text: '', seconds, failure: `no answer after ${String(task.timeoutSeconds)} s`, failureKind: 'timeout' })
    if (result.code === STOPPED)
      return new AgentResult({ text: '', seconds, failure: 'stopped before it answered', failureKind: 'stopped' })

    const printed = parseJson(result.stdout)

    if (!isRecord(printed))
      return new AgentResult({ text: '', seconds, failure: `claude exited with ${String(result.code)}: ${result.output.trim()}` })

    const text = typeof printed.result === 'string' ? printed.result : ''
    const costUsd = typeof printed.total_cost_usd === 'number' ? printed.total_cost_usd : null

    if (printed.is_error === true || result.code !== 0)
      return new AgentResult({ text, seconds, costUsd, failure: text || `claude exited with ${String(result.code)}` })

    if (task.answerSchema === null) return new AgentResult({ text, seconds, costUsd })

    const answer = printed.structured_output ?? parseJson(text)

    return new AgentResult({ text, seconds, costUsd, answer, failure: answer === undefined ? UNSHAPED : null, failureKind: 'answer' })
  }

  // The prompt is read on the standard input: an argument has a size limit that a long change goes over. A task is
  // asked once and never resumed, so it leaves no session behind among the owner's.
  private args(task: AgentTask, scratch: string): string[] {
    const model = task.model === null ? [] : ['--model', task.model]
    const effort = task.effort === null ? [] : ['--effort', task.effort]
    const schema = task.answerSchema === null ? [] : ['--json-schema', JSON.stringify(task.answerSchema)]

    return [
      ...['-p', '--output-format', 'json', '--no-session-persistence'],
      ...['--setting-sources', '', '--strict-mcp-config'],
      ...model,
      ...effort,
      ...schema,
      ...(task.access === 'write' ? this.writing(task, scratch) : this.reading()),
    ]
  }

  // Without a terminal, a tool that is not allowed is refused: naming the reading tools is what makes a task read-only.
  private reading(): string[] {
    return ['--allowedTools', ...READING_TOOLS]
  }

  // This runtime has no sandbox of its own: what holds a task that writes is the command started before each call.
  private writing(task: AgentTask, scratch: string): string[] {
    if (task.beforeTool === null) return ['--permission-mode', 'bypassPermissions']

    const [command, ...args] = task.beforeTool
    const hook = { type: 'command', command, args, timeout: GUARD_TIMEOUT_SECONDS }
    const settings = join(scratch, 'settings.json')

    writeFileSync(settings, JSON.stringify({ hooks: { PreToolUse: [{ matcher: '*', hooks: [hook] }] } }))

    return ['--permission-mode', 'bypassPermissions', '--settings', settings]
  }
}
