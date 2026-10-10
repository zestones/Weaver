import { AgentCatalog, type Agent, type AgentName } from '@weaver/engine'
import type { EngineLink } from '../link/engine-link.ts'
import { ClaudeCodeSettings } from './claude-code-settings.ts'
import { CodexSettings } from './codex-settings.ts'
import type { RuntimeSettings } from './runtime-settings.ts'

type SettingsClass = new (agent: Agent, top: string, link: EngineLink) => RuntimeSettings

export class RuntimeCatalog {
  private readonly agents = new AgentCatalog().agents
  private readonly files: Readonly<Record<AgentName, SettingsClass>> = { claude: ClaudeCodeSettings, codex: CodexSettings }

  // No name means every runtime.
  settings(top: string, link: EngineLink, names: readonly string[]): RuntimeSettings[] {
    const unknown = names.filter((name) => !this.agents.some((agent) => agent.name === name))

    if (unknown.length > 0) {
      throw new Error(`unknown agent runtime ${unknown.join(', ')}: Weaver reads ${this.agents.map((agent) => agent.name).join(', ')}`)
    }

    return this.agents
      .filter((agent) => names.length === 0 || names.includes(agent.name))
      .map((agent) => new this.files[agent.name](agent, top, link))
  }
}
