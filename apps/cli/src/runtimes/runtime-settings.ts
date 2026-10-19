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
// The end of a call waits for the checks that warn.
const AFTER_CALL_SECONDS = 120
const TIMEOUT_SECONDS: Readonly<Record<string, number>> = {
  UserPromptSubmit: 30,
  PreToolUse: 10,
  PostToolUse: AFTER_CALL_SECONDS,
  PostToolUseFailure: AFTER_CALL_SECONDS,
  Stop: END_OF_TURN_SECONDS,
}
const DEFAULT_TIMEOUT_SECONDS = 60
// A release is installed in a folder named after its tag.
const RELEASE_FOLDER = /[\\/]weaver[\\/](v\d+\.\d+\.\d+[^\\/"]*)[\\/]/

export abstract class RuntimeSettings {
  static readonly END_OF_TURN_SECONDS = END_OF_TURN_SECONDS
  static readonly AFTER_CALL_SECONDS = AFTER_CALL_SECONDS

  abstract readonly label: string
  abstract readonly file: string
  // Where the runtime finds the guide of Weaver, as a skill of the project.
  abstract readonly guide: string
  // A personal skill of the same name, which the runtime reads in place of the guide; null where it does not say.
  abstract readonly hidingGuide: string | null
  // Where the runtime loads the mod that shows the end of a task in its chat; null for a runtime that loads none.
  abstract readonly mod: string | null
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

  // A hook is wired as this Weaver writes it: its command, and the tools it is called for.
  wiring(): Wiring {
    const hooks = this.read().hooks ?? {}
    const ours = (event: string): HookGroup[] =>
      (hooks[event] ?? []).filter((group) => (group.hooks ?? []).some((hook) => this.link.owns(hook.command ?? '')))

    if (Object.keys(hooks).every((event) => ours(event).length === 0)) return 'absent'

    const wired = this.agent.events.every((event) => {
      const { matcher, hooks: [expected] = [] } = this.group(event)

      return ours(event).some(
        (group) => group.matcher === matcher && (group.hooks ?? []).some((hook) => hook.command === expected?.command),
      )
    })

    return wired ? 'installed' : 'stale'
  }

  // The release whose hooks are wired here, by its tag; null when they are those of a checkout, or when none is.
  wiredTag(): string | null {
    const commands = Object.values(this.read().hooks ?? {})
      .flatMap((groups) => groups.flatMap((group) => group.hooks ?? []))
      .map((hook) => hook.command ?? '')
      .filter((command) => this.link.owns(command))

    return commands.map((command) => RELEASE_FOLDER.exec(command)?.[1] ?? null).find((tag) => tag !== null) ?? null
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
