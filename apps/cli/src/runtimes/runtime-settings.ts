import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Agent, AgentName } from '@weaver/engine'
import type { EngineLink } from '../link/engine-link.ts'

interface HookEntry {
  readonly type: string
  readonly command?: string
  readonly timeout?: number
}

interface HookGroup {
  readonly matcher?: string
  readonly hooks?: readonly HookEntry[]
}

type Hooks = Record<string, readonly HookGroup[]>

interface Settings {
  readonly hooks?: Hooks
  readonly [key: string]: unknown
}

export type Wiring = 'absent' | 'stale' | 'installed'

const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure'])
// The end of a turn waits for the project's checks, then for its reviewer.
const END_OF_TURN_SECONDS = 3600
const TIMEOUT_SECONDS: Readonly<Record<string, number>> = {
  UserPromptSubmit: 30,
  PreToolUse: 10,
  PostToolUse: 120,
  PostToolUseFailure: 120,
  Stop: END_OF_TURN_SECONDS,
}
const DEFAULT_TIMEOUT_SECONDS = 60

export abstract class RuntimeSettings {
  static readonly END_OF_TURN_SECONDS = END_OF_TURN_SECONDS

  abstract readonly label: string
  abstract readonly file: string
  private readonly agent: Agent
  private readonly top: string
  private readonly link: EngineLink

  constructor(agent: Agent, top: string, link: EngineLink) {
    this.agent = agent
    this.top = top
    this.link = link
  }

  install(): void {
    const settings = this.read()
    const hooks = this.withoutWeaver(settings.hooks ?? {})

    for (const event of this.agent.events) hooks[event] = [...(hooks[event] ?? []), this.group(event)]

    this.write({ ...settings, hooks })
  }

  uninstall(): boolean {
    if (this.wiring() === 'absent') return false

    const { hooks: wired = {}, ...others } = this.read()
    const hooks = this.withoutWeaver(wired)
    const left: Settings = Object.keys(hooks).length === 0 ? others : { ...others, hooks }

    if (Object.keys(left).length === 0) rmSync(this.path)
    else this.write(left)

    return true
  }

  wiring(): Wiring {
    const commands = Object.values(this.read().hooks ?? {})
      .flatMap((groups) => groups.flatMap((group) => group.hooks ?? []))
      .map((hook) => hook.command ?? '')
      .filter((command) => this.link.owns(command))

    if (commands.length === 0) return 'absent'

    return this.commands().every((command) => commands.includes(command)) ? 'installed' : 'stale'
  }

  get runtime(): AgentName {
    return this.agent.name
  }

  // The hooks an install writes, one an event.
  commands(): string[] {
    return this.agent.events.map((event) => this.link.command(event, this.agent.name))
  }

  private get path(): string {
    return join(this.top, this.file)
  }

  private group(event: string): HookGroup {
    const hook = {
      type: 'command',
      command: this.link.command(event, this.agent.name),
      timeout: TIMEOUT_SECONDS[event] ?? DEFAULT_TIMEOUT_SECONDS,
    }

    return TOOL_EVENTS.has(event) ? { matcher: this.agent.tools.join('|'), hooks: [hook] } : { hooks: [hook] }
  }

  // What the owner or another tool put in the file stays as it is.
  private withoutWeaver(hooks: Hooks): Record<string, HookGroup[]> {
    const others = Object.entries(hooks).map(([event, groups]): [string, HookGroup[]] => [
      event,
      groups.filter((group) => !(group.hooks ?? []).some((hook) => this.link.owns(hook.command ?? ''))),
    ])

    return Object.fromEntries(others.filter(([, groups]) => groups.length > 0))
  }

  private read(): Settings {
    if (!existsSync(this.path)) return {}

    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as Settings
    } catch {
      throw new Error(`${this.file} is not valid JSON: fix it or remove it, then run the command again`)
    }
  }

  private write(settings: Settings): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, `${JSON.stringify(settings, null, 2)}\n`)
  }
}
