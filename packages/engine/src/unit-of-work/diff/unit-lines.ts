import type { Session } from '../session/session.ts'
import type { UnitOfWork } from '../unit/unit-of-work.ts'
import { UnitDiff } from './unit-diff.ts'

type Ranges = readonly (readonly [number, number])[]

// The lines a unit of work wrote, file by file. Its diff is read the first time a file is asked about: most calls
// never ask.
export class UnitLines {
  private readonly session: Session
  private readonly unit: UnitOfWork
  private read: { readonly ranges: ReadonlyMap<string, Ranges> | null } | null = null

  constructor(session: Session, unit: UnitOfWork) {
    this.session = session
    this.unit = unit
  }

  // [] for a file the unit did not change, null when its diff cannot be read.
  of(file: string): Ranges | null {
    if (this.unit.isEmpty) return []

    this.read ??= { ranges: this.ranges() }

    return this.read.ranges === null ? null : (this.read.ranges.get(file) ?? [])
  }

  private ranges(): Map<string, Ranges> | null {
    const { repo, dir } = this.session

    try {
      // Nothing is left out: a folder the checks do not look at is the unit's work all the same.
      return new Map(UnitDiff.of(repo, dir, this.unit.files, []).files.map((file) => [file.path, file.added]))
    } catch {
      return null
    }
  }
}
