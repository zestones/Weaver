import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Repository } from '../../lib/git/repository.ts'
import type { Closing, FollowedPoint, OwnerPoint } from './owner-point.ts'

type Entry =
  | { readonly kind: 'open'; readonly point: OwnerPoint }
  | { readonly kind: 'close'; readonly id: string; readonly as: Closing; readonly note: string | null; readonly at: string }

// What the reviews of a repository left for its owner, across sessions, until the owner closes each point. Entries
// are only ever added, one a line, so that two sessions writing at once lose nothing.
export class ReviewLedger {
  static readonly CLOSINGS: readonly Closing[] = ['fixed', 'wontfix', 'issue']

  static describe(point: OwnerPoint): string {
    const place = point.line === null ? (point.file ?? 'the change') : `${point.file ?? ''}:${String(point.line)}`

    return `${point.rule ?? ''} ${place}: ${point.message}`.trimStart()
  }

  private readonly path: string

  constructor(repo: Repository) {
    this.path = join(repo.stateDir, 'review-ledger.jsonl')
  }

  open(points: readonly OwnerPoint[]): void {
    for (const point of points) this.add({ kind: 'open', point })
  }

  // null when the point is closed; otherwise why it could not be.
  close(id: string, as: Closing, note: string | null): string | null {
    const point = this.points().find((known) => known.id === id)

    if (point === undefined) return `no point is named ${id}`
    if (point.closed !== null) return `${id} is already closed as ${point.closed.as}`

    this.add({ kind: 'close', id, as, note, at: new Date().toISOString() })

    return null
  }

  waiting(): FollowedPoint[] {
    return this.points().filter((point) => point.closed === null)
  }

  // What was left about these files, closed or not, as a later reviewer reads it.
  about(paths: readonly string[]): string[] {
    return this.points()
      .filter((point) => point.file !== null && paths.includes(point.file))
      .map((point) => {
        const fate = point.closed === null ? point.standing : `${point.standing}; closed by the owner as ${point.closed.as}`

        return `${ReviewLedger.describe(point)} (${fate})`
      })
  }

  private points(): FollowedPoint[] {
    const points = new Map<string, FollowedPoint>()

    for (const entry of this.entries()) {
      const known = entry.kind === 'close' ? points.get(entry.id) : undefined

      if (entry.kind === 'open') points.set(entry.point.id, { ...entry.point, closed: null })
      else if (known !== undefined) points.set(entry.id, { ...known, closed: { as: entry.as, note: entry.note, at: entry.at } })
    }

    return [...points.values()]
  }

  private entries(): Entry[] {
    if (!existsSync(this.path)) return []

    return readFileSync(this.path, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Entry)
  }

  private add(entry: Entry): void {
    mkdirSync(dirname(this.path), { recursive: true })
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`)
  }
}
