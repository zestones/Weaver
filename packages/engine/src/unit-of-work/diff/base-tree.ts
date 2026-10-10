import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { Repository } from '../../lib/git/repository.ts'
import type { UnitFile } from '../unit/unit-record.ts'

const NULL_BLOB = '0000000000000000000000000000000000000000'

// The tree a unit of work is checked against: a snapshot with only the session's files put back as they were before
// it touched them. What others changed is on both sides, so it never shows in the unit's diff.
export class BaseTree {
  private readonly repo: Repository
  private readonly index: string

  constructor(repo: Repository, dir: string) {
    this.repo = repo
    this.index = join(dir, 'base-index')
  }

  of(head: string, files: Readonly<Record<string, UnitFile>>): string {
    const { repo, index } = this
    const paths = this.checkedPaths(Object.keys(files))
    const modes = repo.treeEntries(head, paths)
    const lines = paths.map((path) => {
      const base = files[path]?.base ?? null

      return base === null ? `0 ${NULL_BLOB}\t${path}` : `${modes.get(path)?.mode ?? Repository.REGULAR_MODE} ${base}\t${path}`
    })

    repo.git(['read-tree', head], { index })
    if (lines.length > 0) repo.git(['update-index', '--index-info'], { index, input: `${lines.join('\n')}\n` })

    return repo.git(['write-tree'], { index })
  }

  // A file git ignores is not in a snapshot, so it has no base to put back; unless it is committed: a staged deletion
  // leaves the index, but its committed source must still be checked.
  private checkedPaths(paths: readonly string[]): readonly string[] {
    const { repo } = this

    if (paths.length === 0) return paths

    const result = spawnSync('git', ['-C', repo.top, 'check-ignore', '--stdin', '-z'], {
      input: `${paths.join('\0')}\0`,
      encoding: 'utf8',
      env: repo.env(),
    })

    if (result.error !== undefined) throw result.error
    if (result.status !== 0 && result.status !== 1) throw new Error(`Cannot classify ignored unit files: ${result.stderr.trim()}`)

    const ignored = new Set(result.stdout.split('\0').filter(Boolean))
    const committed = repo.treeEntries('HEAD', [...ignored])

    return paths.filter((path) => !ignored.has(path) || committed.has(path))
  }
}
