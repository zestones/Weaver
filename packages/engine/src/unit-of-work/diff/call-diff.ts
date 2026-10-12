import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Repository } from '../../lib/git/repository.ts'
import type { ChangedPath } from '../../lib/git/tree-diff.ts'
import type { Change } from '../attribution/attribution-window.ts'

// What one tool call changed, as the checks that warn right after it are told of it.
export class CallDiff {
  readonly repo: Repository
  private readonly dir: string
  private readonly callId: string
  private readonly changes: ReadonlyMap<string, Change>

  constructor(repo: Repository, dir: string, callId: string, changes: ReadonlyMap<string, Change>) {
    this.repo = repo
    this.dir = dir
    this.callId = callId
    this.changes = changes
  }

  // The changes of a call, without the folders no check looks at.
  static of(repo: Repository, dir: string, callId: string, changes: ReadonlyMap<string, Change>, exclude: readonly string[]): CallDiff {
    const looked = [...changes].filter(([path]) => !exclude.some((folder) => path === folder || path.startsWith(`${folder}/`)))

    return new CallDiff(repo, dir, callId, new Map(looked))
  }

  get isEmpty(): boolean {
    return this.changes.size === 0
  }

  get files(): ChangedPath[] {
    return [...this.changes].map(([path, change]) => ({ status: this.statusOf(change), path, oldPath: path }))
  }

  // Each file comes with what it held before the call and what it holds now, as blobs of the store.
  environment(): NodeJS.ProcessEnv {
    const files = [...this.changes].map(([path, change]) => ({ status: this.statusOf(change), path, ...change }))

    mkdirSync(this.dir, { recursive: true })
    writeFileSync(this.diffPath, JSON.stringify(files, null, 2))

    return { ...process.env, WEAVER_GIT_OBJECTS: this.repo.objectStore, WEAVER_CALL_DIFF: this.diffPath }
  }

  forget(): void {
    rmSync(this.diffPath, { force: true })
  }

  // Calls of one session may end at the same time: each has a file of its own.
  private get diffPath(): string {
    return join(this.dir, `call-diff-${this.callId.replace(/[^\w.-]/g, '_')}.json`)
  }

  private statusOf(change: Change): 'A' | 'M' | 'D' {
    if (change.after === null) return 'D'

    return change.before === null ? 'A' : 'M'
  }
}
