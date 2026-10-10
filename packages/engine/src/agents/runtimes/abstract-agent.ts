import { AgentEvent } from '../events/agent-event.ts'
import type { Payload } from '../events/payload.ts'
import type { EditCall } from '../tool-calls/edit-call.ts'
import { OtherCall } from '../tool-calls/other-call.ts'
import { ShellCall } from '../tool-calls/shell-call.ts'
import type { ToolCall } from '../tool-calls/tool-call.ts'
import type { Agent, AgentName } from './agent.ts'

const SHELL_TOOLS = new Set(['Bash', 'Monitor', 'PowerShell'])
// Monitor returns while its command goes on.
const WATCHER = 'Monitor'

export abstract class AbstractAgent implements Agent {
  abstract readonly name: AgentName

  read(payload: Payload): AgentEvent {
    const cwd = payload.text('cwd') ?? process.cwd()
    const tool = payload.text('tool_name')

    return new AgentEvent({
      sessionId: payload.text('session_id'),
      callId: payload.text('tool_use_id'),
      cwd,
      prompt: payload.text('prompt'),
      call: tool === null ? null : this.call(tool, payload.record('tool_input'), cwd),
      subagent: payload.text('agent_id') !== null,
      lastMessage: payload.text('last_assistant_message'),
    })
  }

  protected abstract editCall(tool: string, input: Payload, cwd: string): EditCall | null

  private call(tool: string, input: Payload, cwd: string): ToolCall {
    if (SHELL_TOOLS.has(tool)) {
      return new ShellCall(tool, input.command('command'), cwd, tool === WATCHER || input.flag('run_in_background'))
    }

    return this.editCall(tool, input, cwd) ?? new OtherCall(tool)
  }
}
