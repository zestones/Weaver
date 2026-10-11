import { join, relative, sep } from 'node:path'
import type { ToolCall } from '../../agents/tool-calls/tool-call.ts'
import { DeclarationFolder } from '../../declaration/reading/declaration-folder.ts'
import { realPath } from '../../lib/files/real-path.ts'
import type { Repository } from '../../lib/git/repository.ts'
import type { Refusal } from '../results/refusal.ts'
import { Guard } from './guard.ts'

const AGENT_HOOKS = ['.claude/settings.json', '.claude/settings.local.json', '.codex']

// What no project can switch off: an agent that could change these could unplug what checks it.
export class EngineGuard extends Guard {
  private readonly top: string
  private readonly owned: readonly string[]

  constructor(repo: Repository, skills: readonly string[]) {
    super({
      id: 'weaver:protected',
      statement:
        "Weaver's configuration, its state, the agent's hook settings and the skills Weaver relies on are the owner's. Describe the change you need; the owner makes it.",
    })
    this.top = realPath(repo.top)
    this.owned = [
      join(repo.top, DeclarationFolder.NAME),
      join(repo.gitDir, 'weaver'),
      join(repo.commonDir, 'weaver'),
      ...AGENT_HOOKS.map((path) => join(repo.top, path)),
      ...skills.map((skill) => join(repo.top, skill)),
    ].map(realPath)
  }

  override refusal(call: ToolCall): Refusal | null {
    const { written, removed } = call.named()
    const hit = written.map(realPath).find((path) => this.owns(path)) ?? removed.map(realPath).find((folder) => this.holds(folder))

    if (hit === undefined) return null

    const inside = relative(this.top, hit)

    return this.refuse(`Writing ${inside === '' || inside.startsWith('..') ? hit : inside}`)
  }

  private owns(path: string): boolean {
    return this.owned.some((own) => path === own || path.startsWith(`${own}${sep}`))
  }

  private holds(folder: string): boolean {
    return this.owned.some((own) => own.startsWith(`${folder}${sep}`))
  }
}
