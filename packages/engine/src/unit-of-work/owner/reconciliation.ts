import type { Blob, Repository } from '../../lib/git/repository.ts'
import type { UnitOfWork } from '../unit/unit-of-work.ts'
import type { UnitFile } from '../unit/unit-record.ts'

export interface Reconciled {
  readonly head: string | null
  readonly unit: UnitOfWork
  readonly notes: readonly string[]
}

interface Outcome {
  readonly file: UnitFile | null
  readonly note: string | null
}

interface OwnerAction {
  readonly head: ReadonlyMap<string, Blob>
  readonly moved: ReadonlySet<string>
}

// No hook sees the owner's own commands, so the session compares what it left with what is there. Commits are the
// owner's: a file they put at HEAD is no longer the agent's to answer for.
export class Reconciliation {
  private readonly repo: Repository
  private readonly lastHead: string | null
  private readonly unit: UnitOfWork

  constructor(repo: Repository, lastHead: string | null, unit: UnitOfWork) {
    this.repo = repo
    this.lastHead = lastHead
    this.unit = unit
  }

  apply(): Reconciled {
    const head = this.repo.head()
    const paths = Object.keys(this.unit.files)
    const current = this.repo.hashPaths(paths)
    const action = this.ownerAction(head, paths)

    const outcomes = Object.entries(this.unit.files).map(([path, file]) => {
      const blob = current.get(path) ?? null

      return [path, action === null ? this.edited(file, blob) : this.afterOwnerAction(path, file, blob, action)] as const
    })
    const files = Object.fromEntries(outcomes.flatMap(([path, outcome]) => (outcome.file === null ? [] : [[path, outcome.file]])))
    const unit = action === null ? this.unit.withFiles(files) : this.unit.withFiles(files).withoutReturned()

    return { head, unit, notes: outcomes.flatMap(([, outcome]) => outcome.note ?? []) }
  }

  private ownerAction(head: string | null, paths: readonly string[]): OwnerAction | null {
    const { repo, lastHead } = this

    if (lastHead === null || head === null || head === lastHead) return null

    const now = repo.blobsAt(head, paths)
    const before = repo.blobsAt(lastHead, paths)

    return { head: now, moved: new Set(paths.filter((path) => before.get(path) !== now.get(path))) }
  }

  // A file the owner's git action put at HEAD leaves the unit; one whose HEAD content the action moved is the owner's
  // too: rewritten content leaves, the agent's own gets the new HEAD as its base. Any other change is an edit by someone.
  private afterOwnerAction(path: string, file: UnitFile, current: Blob, action: OwnerAction): Outcome {
    const head = action.head.get(path) ?? null

    if (head === current) return { file: null, note: `${path} settled by your git action` }
    if (!action.moved.has(path)) return this.edited(file, current)
    if (current !== file.last) return { file: null, note: `${path} re-based on your git action` }

    return { file: head === null ? file : { ...file, base: head }, note: null }
  }

  private edited(file: UnitFile, current: Blob): Outcome {
    return current === file.last ? { file, note: null } : { file: { ...file, last: current, foreign: true }, note: null }
  }
}
