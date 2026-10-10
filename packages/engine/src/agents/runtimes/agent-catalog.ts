import type { Agent } from './agent.ts'
import { ClaudeCode } from './claude-code.ts'
import { Codex } from './codex.ts'

const FLAG = '--agent='

export class AgentCatalog {
  private readonly claude = new ClaudeCode()
  readonly agents: readonly Agent[] = [this.claude, new Codex()]

  fromArguments(argv: readonly string[]): Agent {
    const name = argv.find((arg) => arg.startsWith(FLAG))?.slice(FLAG.length)

    return this.agents.find((agent) => agent.name === name) ?? this.claude
  }
}
