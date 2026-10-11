import type { Repository } from './repository.ts'

type LineRange = [number, number]

export interface ChangedFile {
  readonly status: 'A' | 'M' | 'D' | 'R' | 'C' | 'T'
  readonly path: string
  readonly oldPath: string
  // New-side line ranges that were added or modified, 1-based and inclusive.
  readonly added: readonly (readonly [number, number])[]
}

export interface ExcludedFolder {
  readonly folder: string
  readonly files: number
}

// Pinned so that a user's diff.noprefix, diff.mnemonicPrefix or core.quotePath cannot change the output.
const PINNED = ['-c', 'core.quotePath=false', '-c', 'diff.noprefix=false', '-c', 'diff.mnemonicPrefix=false']
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/
// `+++ b/` precedes the new path.
const NEW_PATH_OFFSET = 6

function hunkRanges(line: string): LineRange[] {
  const hunk = HUNK.exec(line)

  if (hunk === null) return []

  const start = Number(hunk[1])
  const count = hunk[2] === undefined ? 1 : Number(hunk[2])

  return count > 0 ? [[start, start + count - 1]] : []
}

export class TreeDiff {
  private readonly repo: Repository
  private readonly base: string
  private readonly head: string

  constructor(repo: Repository, base: string, head: string) {
    this.repo = repo
    this.base = base
    this.head = head
  }

  files(excluded: readonly string[]): ChangedFile[] {
    const pathspec = [':(top)', ...excluded.map((folder) => `:(top,exclude)${folder}`)]
    const ranges = this.addedRanges(pathspec)

    return [...this.listFiles(pathspec)].map(([path, { status, oldPath }]) => ({ status, path, oldPath, added: ranges.get(path) ?? [] }))
  }

  // The changes of these paths as a patch, for a reader rather than for a program.
  patch(paths: readonly string[]): string {
    if (paths.length === 0) return ''

    return this.repo.git([
      ...PINNED,
      'diff',
      '-M',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      this.base,
      this.head,
      '--',
      ...paths.map((path) => `:(top,literal)${path}`),
    ])
  }

  // Lines added and lines removed in these paths; a file that is not text counts for none.
  changedLines(paths: readonly string[]): number {
    if (paths.length === 0) return 0

    return this.repo
      .git([
        ...PINNED,
        'diff',
        '--numstat',
        '--no-ext-diff',
        '--no-textconv',
        this.base,
        this.head,
        '--',
        ...paths.map((path) => `:(top,literal)${path}`),
      ])
      .split('\n')
      .flatMap((row) => row.split('\t').slice(0, 2))
      .reduce((sum, count) => sum + (Number(count) || 0), 0)
  }

  excludedFolders(excluded: readonly string[]): ExcludedFolder[] {
    return excluded.map((folder) => ({ folder, files: this.listFiles([`:(top)${folder}`]).size })).filter((entry) => entry.files > 0)
  }

  private listFiles(pathspec: readonly string[]): Map<string, Pick<ChangedFile, 'status' | 'oldPath'>> {
    const tokens = this.repo
      .git([...PINNED, 'diff-tree', '-r', '-z', '-M', '--no-commit-id', '--name-status', this.base, this.head, '--', ...pathspec])
      .split('\0')
    const files = new Map<string, Pick<ChangedFile, 'status' | 'oldPath'>>()

    for (let index = 0; (tokens[index] ?? '') !== '';) {
      const status = (tokens[index] ?? 'M').charAt(0) as ChangedFile['status']
      const first = tokens[index + 1] ?? ''
      const moved = status === 'R' || status === 'C'
      const path = moved ? (tokens[index + 2] ?? first) : first

      files.set(path, { status, oldPath: first })
      index += moved ? 3 : 2
    }

    return files
  }

  private addedRanges(pathspec: readonly string[]): Map<string, LineRange[]> {
    const diff = this.repo.git([
      ...PINNED,
      'diff',
      '-U0',
      '-M',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      this.base,
      this.head,
      '--',
      ...pathspec,
    ])
    const ranges = new Map<string, LineRange[]>()
    let current: LineRange[] | null = null

    for (const line of diff.split('\n')) {
      if (line === '+++ /dev/null') current = null
      else if (line.startsWith('+++ ')) {
        current = []
        ranges.set(line.slice(NEW_PATH_OFFSET), current)
      } else current?.push(...hunkRanges(line))
    }

    return ranges
  }
}
