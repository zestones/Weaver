import { join } from 'node:path'
import type { Repository } from '../../lib/git/repository.ts'
import { PathsGuard } from './paths-guard.ts'

const AGENT_HOOKS = ['.claude/settings.json', '.claude/settings.local.json', '.codex']

// What nothing switches off, not even the owner's maintenance: an agent that could change these could unplug what
// checks it, or put itself in maintenance.
export class EngineGuard extends PathsGuard {
  constructor(repo: Repository) {
    super(
      {
        id: 'weaver:protected',
        statement:
          "Weaver's state and the agent's hook settings are the owner's, in maintenance too. Describe the change you need; the owner makes it.",
        liftable: false,
      },
      repo.top,
      [join(repo.gitDir, 'weaver'), join(repo.commonDir, 'weaver'), ...AGENT_HOOKS.map((path) => join(repo.top, path))],
    )
  }
}
