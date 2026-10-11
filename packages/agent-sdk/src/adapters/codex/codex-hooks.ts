import { converse, type Heard } from '../../lib/process/conversation.ts'
import { isRecord, parseJson } from '../../lib/text/json.ts'
import type { RuntimeHook, RuntimeHooks } from '../../ports/runtime-hooks.ts'

type Message = Readonly<Record<string, unknown>>

const TIMEOUT_MS = 10_000
const HELLO = 0
const LIST = 1
// Codex runs a hook it was given by an administrator without asking the owner.
const APPROVED = new Set(['trusted', 'managed'])

// The hooks Codex holds for a folder, asked to its app server. Only Codex can say whether a hook will run: it loads
// the hooks of a project once the owner trusts the project, then runs each one once the owner has approved it as it
// is written, and asks again when it changes.
export class CodexHooks {
  private readonly binary: string
  private readonly timeoutMs: number

  constructor(binary: string, timeoutMs = TIMEOUT_MS) {
    this.binary = binary
    this.timeoutMs = timeoutMs
  }

  async of(cwd: string): Promise<RuntimeHooks> {
    const hello = { method: 'initialize', id: HELLO, params: { clientInfo: { name: 'weaver', title: 'Weaver', version: '1' } } }
    const answer = await converse(this.binary, ['app-server'], { cwd, timeoutMs: this.timeoutMs }, JSON.stringify(hello), (line) =>
      this.heard(line, cwd),
    )

    return answer ?? this.failed('its app server gave no answer')
  }

  private heard(line: string, cwd: string): Heard<RuntimeHooks> {
    const message = parseJson(line)

    if (!isRecord(message) || (message.id !== HELLO && message.id !== LIST)) return null
    if (isRecord(message.error))
      return { answer: this.failed(typeof message.error.message === 'string' ? message.error.message : 'it refused') }
    if (message.id === LIST) return { answer: this.listed(message.result) }

    return { say: [JSON.stringify({ method: 'initialized' }), JSON.stringify({ method: 'hooks/list', id: LIST, params: { cwds: [cwd] } })] }
  }

  private listed(result: unknown): RuntimeHooks {
    const [folder] = isRecord(result) && Array.isArray(result.data) ? (result.data as unknown[]) : []

    if (!isRecord(folder) || !Array.isArray(folder.hooks)) return this.failed('its answer has no list of hooks')

    return { hooks: (folder.hooks as unknown[]).filter(isRecord).flatMap((hook) => this.hook(hook)), failure: null }
  }

  // A hook that is not a command is none of Weaver's.
  private hook(hook: Message): RuntimeHook[] {
    if (typeof hook.command !== 'string') return []
    if (hook.enabled === false) return [{ command: hook.command, standing: 'off' }]

    return [{ command: hook.command, standing: APPROVED.has(String(hook.trustStatus)) ? 'runs' : 'waits' }]
  }

  private failed(failure: string): RuntimeHooks {
    return { hooks: [], failure }
  }
}
