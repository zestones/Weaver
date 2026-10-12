import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Repository } from '../../lib/git/repository.ts'
import { SessionStore } from './session-store.ts'
import { Session } from './session.ts'

// The sessions that worked in a repository and left a state this Weaver reads, the one seen last first.
export class RepositorySessions {
  private readonly repo: Repository

  constructor(repo: Repository) {
    this.repo = repo
  }

  all(): Session[] {
    const root = Session.rootIn(this.repo)
    const ids = existsSync(root) ? readdirSync(root) : []

    return ids
      .flatMap((id) => {
        const record = new SessionStore(join(root, id), '').load()

        return record === null ? [] : [new Session(this.repo, id, record.agent)]
      })
      .sort((one, other) => (other.seenAt?.getTime() ?? 0) - (one.seenAt?.getTime() ?? 0))
  }

  startingWith(start: string): Session[] {
    return this.all().filter((session) => session.id.startsWith(start))
  }

  underMaintenance(): Session[] {
    return this.all().filter((session) => session.maintenance !== null)
  }
}
