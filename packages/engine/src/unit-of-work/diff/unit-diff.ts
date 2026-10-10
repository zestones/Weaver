import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Repository } from '../../lib/git/repository.ts'
import { TreeDiff, type ChangedFile, type ExcludedFolder } from '../../lib/git/tree-diff.ts'
import { WorkingTreeSnapshot } from '../../lib/git/working-tree-snapshot.ts'
import type { UnitFile } from '../unit/unit-record.ts'
import { BaseTree } from './base-tree.ts'

export interface UnitDiffFields {
  readonly repo: Repository
  readonly dir: string
  readonly base: string
  readonly head: string
  readonly files: readonly ChangedFile[]
  readonly excluded: readonly ExcludedFolder[]
}

export class UnitDiff {
  readonly repo: Repository
  readonly dir: string
  readonly base: string
  readonly head: string
  readonly files: readonly ChangedFile[]
  readonly excluded: readonly ExcludedFolder[]

  constructor(fields: UnitDiffFields) {
    this.repo = fields.repo
    this.dir = fields.dir
    this.base = fields.base
    this.head = fields.head
    this.files = fields.files
    this.excluded = fields.excluded
  }

  static of(repo: Repository, dir: string, files: Readonly<Record<string, UnitFile>>, exclude: readonly string[]): UnitDiff {
    const head = new WorkingTreeSnapshot(repo, dir).tree()
    const base = new BaseTree(repo, dir).of(head, files)
    const diff = new TreeDiff(repo, base, head)

    return new UnitDiff({ repo, dir, base, head, files: diff.files(exclude), excluded: diff.excludedFolders(exclude) })
  }

  get paths(): string[] {
    return this.files.map((file) => file.path)
  }

  changes(path: string): boolean {
    return this.files.some((file) => file.path === path || file.oldPath === path)
  }

  environment(): NodeJS.ProcessEnv {
    const diffPath = join(this.dir, 'unit-diff.json')

    mkdirSync(this.dir, { recursive: true })
    writeFileSync(diffPath, JSON.stringify(this.files, null, 2))

    return {
      ...process.env,
      WEAVER_BASE_TREE: this.base,
      WEAVER_HEAD_TREE: this.head,
      WEAVER_GIT_OBJECTS: this.repo.objectStore,
      WEAVER_UNIT_DIFF: diffPath,
    }
  }
}
