import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Repository } from '../../lib/git/repository.ts'
import { SessionStore } from './session-store.ts'

// The files another session of the repository is working on: in its unit of work, and not as HEAD holds them. A
// command that cannot say what it writes is charged with what changed while it ran, but never with these.
export class HeldElsewhere {
  // A session not at work for this long holds nothing: it was left, as one is for a new conversation. Its end of turn
  // may run a review this long without a word to its state.
  static readonly LEFT_AFTER_MS = 3 * 60 * 60 * 1000

  private readonly repo: Repository
  private readonly root: string
  private readonly own: string

  constructor(repo: Repository, root: string, own: string) {
    this.repo = repo
    this.root = root
    this.own = own
  }

  among(paths: readonly string[]): ReadonlySet<string> {
    const others = existsSync(this.root) ? readdirSync(this.root).filter((id) => id !== this.own) : []
    const left = Date.now() - HeldElsewhere.LEFT_AFTER_MS
    const held = others.flatMap((id) => {
      const store = new SessionStore(join(this.root, id), '')

      if ((store.changedAt()?.getTime() ?? 0) < left) return []

      const files = store.load()?.unit.files ?? {}

      return paths.flatMap((path) => {
        const file = files[path]

        return file === undefined ? [] : [{ path, last: file.last }]
      })
    })

    if (held.length === 0) return new Set()

    const atHead = this.repo.blobsAt(
      'HEAD',
      held.map(({ path }) => path),
    )

    return new Set(held.filter(({ path, last }) => last !== (atHead.get(path) ?? null)).map(({ path }) => path))
  }
}
