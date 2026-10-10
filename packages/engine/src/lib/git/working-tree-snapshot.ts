import { copyFileSync, existsSync, lstatSync, rmSync, statSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import type { Repository } from './repository.ts'

export class WorkingTreeSnapshot {
  private readonly repo: Repository
  private readonly index: string

  constructor(repo: Repository, dir: string) {
    this.repo = repo
    this.index = join(dir, 'index')
  }

  // If the snapshot object store was emptied, the index names blobs that no longer exist and `write-tree` refuses to
  // build the tree. The index is a cache: it is thrown away and rebuilt from nothing.
  tree(): string {
    if (!existsSync(this.index)) this.seedIndex(true)

    try {
      return this.writeTree()
    } catch {
      rmSync(this.index, { force: true })
      this.seedIndex(false)

      return this.writeTree()
    }
  }

  private writeTree(): string {
    this.includeTrackedIgnored()
    this.repo.git(['add', '-A', '--', '.'], { index: this.index })

    return this.repo.git(['write-tree'], { index: this.index })
  }

  private seedIndex(fromOwner: boolean): void {
    const ownerIndex = join(this.repo.gitDir, 'index')

    if (!fromOwner || !existsSync(ownerIndex)) {
      this.repo.git(['read-tree', '--empty'], { index: this.index })

      return
    }

    const { atime, mtime } = statSync(ownerIndex)

    copyFileSync(ownerIndex, this.index)
    // Git trusts the cached stat of an entry only when the file is older than the index that holds it. A copy is younger
    // than everything it lists, so it keeps the age of the original: an edit of the same size made in the second the
    // owner's index recorded the file would otherwise never reach the snapshot.
    utimesSync(this.index, atime, mtime)
  }

  // The owner may stage an ignored file after the private index was seeded.
  private includeTrackedIgnored(): void {
    const paths = this.repo
      .git(['ls-files', '--cached', '--ignored', '--exclude-standard', '-z'])
      .split('\0')
      .filter(Boolean)
      .filter((path) => {
        const entry = lstatSync(join(this.repo.top, path), { throwIfNoEntry: false })

        return entry !== undefined && !entry.isDirectory()
      })

    if (paths.length > 0) {
      this.repo.git(['add', '--force', '--', ...paths.map((path) => `:(top,literal)${path}`)], { index: this.index })
    }
  }
}
