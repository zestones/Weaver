import { inScope } from '../../lib/git/path-scope.ts'
import type { Blob, Repository } from '../../lib/git/repository.ts'
import type { WriteScope } from '../../lib/shell/writes/write-scope.ts'
import { Attribution } from './attribution.ts'
import type { WindowRecord } from './window-record.ts'

export interface WatchedCall {
  readonly tool: string
  // The paths an edit tool names; null for a shell command, which may touch any path that differs from HEAD.
  readonly targets: readonly string[] | null
  readonly scope: WriteScope
  readonly untilStop: boolean
  // The subagent that makes the call; null for the agent itself.
  readonly agent: string | null
}

export interface Change {
  readonly before: Blob
  readonly after: Blob
}

export interface HeadMove {
  readonly from: string | null
  readonly to: string | null
}

export interface ClosedWindow {
  readonly charged: ReadonlyMap<string, Change>
  readonly shown: readonly string[]
  readonly headMoved: HeadMove | null
}

// Opens before a call on what the files hold and closes after it on what changed: that is how a change is known to be
// the call's, and not the owner's or another session's.
export class AttributionWindow {
  readonly record: WindowRecord

  constructor(record: WindowRecord) {
    this.record = record
  }

  static open(repo: Repository, call: WatchedCall, exclude: readonly string[] = []): AttributionWindow {
    const paths = (call.targets ?? repo.dirtyPaths()).filter((path) => inScope(path, exclude))
    const before = repo.hashPaths(paths)

    return new AttributionWindow({
      at: new Date().toISOString(),
      tool: call.tool,
      untilStop: call.untilStop,
      exact: call.targets !== null,
      before: Object.fromEntries(before),
      unavailable: paths.filter((path) => !before.has(path)),
      exclude,
      head: repo.head(),
      attribution: call.scope,
      agent: call.agent,
      task: null,
    })
  }

  get tool(): string {
    return this.record.tool
  }

  get openedAt(): string {
    return this.record.at
  }

  // Whether the call may still be running for one of these tasks: its own, or the one of the subagent that made it.
  runsFor(tasks: ReadonlySet<string>): boolean {
    const { task, agent } = this.record

    return (task !== null && tasks.has(task)) || (agent !== null && tasks.has(agent))
  }

  // The same call watched again from now: what it changed until now has been charged.
  reopened(repo: Repository): AttributionWindow {
    const { before, exact, exclude = [] } = this.record
    const paths = (exact ? Object.keys(before) : repo.dirtyPaths()).filter((path) => inScope(path, exclude))
    const hashed = repo.hashPaths(paths)

    return new AttributionWindow({
      ...this.record,
      at: new Date().toISOString(),
      before: Object.fromEntries(hashed),
      unavailable: paths.filter((path) => !hashed.has(path)),
      head: repo.head(),
    })
  }

  // The paths a call that names its writes is about to change.
  get claims(): string[] {
    return this.record.exact ? Object.keys(this.record.before) : []
  }

  // `heldElsewhere` gives, among paths, those another session works on: a call that may have written anything is not
  // charged with them, since it cannot be told who did.
  close(repo: Repository, heldElsewhere: (paths: readonly string[]) => ReadonlySet<string>): ClosedWindow {
    const changes = this.changes(repo)
    const attribution = new Attribution(this.record.attribution)
    const broad = this.record.attribution === 'all' && !this.record.exact
    const held = broad ? heldElsewhere([...changes.keys()]) : new Set<string>()
    const charged = new Map([...changes].filter(([path]) => attribution.charges(path) && !held.has(path)))
    const head = repo.head()

    return {
      charged,
      shown: [...changes.keys()].filter((path) => !charged.has(path)),
      headMoved: head === this.record.head ? null : { from: this.record.head, to: head },
    }
  }

  private changes(repo: Repository): Map<string, Change> {
    const watched = Object.keys(this.record.before)
    const candidates = (this.record.exact ? watched : [...new Set([...watched, ...repo.dirtyPaths()])]).filter(
      (path) => inScope(path, this.record.exclude ?? []) && !this.record.unavailable?.includes(path),
    )
    const after = repo.hashPaths(candidates)
    const before = this.before(repo, candidates)
    const changes = new Map<string, Change>()

    for (const path of candidates) {
      if (!after.has(path)) continue

      const previous = before.get(path) ?? null
      const current = after.get(path) ?? null

      if (previous !== current) changes.set(path, { before: previous, after: current })
    }

    return changes
  }

  // A path that was clean when the window opened held what HEAD holds.
  private before(repo: Repository, paths: readonly string[]): Map<string, Blob> {
    const { before } = this.record
    const atHead = repo.blobsAt(
      this.record.head ?? 'HEAD',
      paths.filter((path) => !(path in before)),
    )

    return new Map(paths.map((path) => [path, path in before ? (before[path] ?? null) : (atHead.get(path) ?? null)]))
  }
}
