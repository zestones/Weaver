import { readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { PlaceText, type CommitNote, type PlaceContext } from '@weaver/memory'
import { realPath } from '../../lib/files/real-path.ts'
import type { Repository } from '../../lib/git/repository.ts'

// The line ranges a unit of work wrote in a file, [] for a file it did not change, null when that cannot be told.
export type WrittenLines = (file: string) => readonly (readonly [number, number])[] | null

const AROUND = 3
const LAST_COMMITS = 3
const FIELD = '\x1f'
// The short name of a commit, its day and its subject.
const NOTE = '--format=%h%x1f%as%x1f%s'
const NOT_COMMITTED = /^0+$/

// What is kept of a place at the moment it is flagged: the repository goes on changing, and the flag is read later.
export class PlaceReader {
  private readonly repo: Repository
  private readonly top: string
  private readonly written: WrittenLines | null

  constructor(repo: Repository, written: WrittenLines | null = null) {
    this.repo = repo
    this.top = realPath(repo.top)
    this.written = written
  }

  // `text` is the place as it was written, `cwd` where the command that names it runs.
  read(text: string, cwd: string): PlaceContext {
    const { path, line } = new PlaceText(text)
    const file = this.inside(path, cwd)
    const lines = file === null ? null : this.lines(file)

    // A path outside the repository is kept as written, as a file that is not there.
    if (file === null || lines === null) {
      return {
        place: { file: file ?? path, line },
        exists: false,
        excerpt: '',
        lineText: null,
        origin: 'unknown',
        wroteBy: [],
        lastCommits: [],
      }
    }

    const flagged = line === null ? null : (lines[line - 1] ?? null)
    const origin = this.origin(file, flagged === null ? null : line)

    return {
      place: { file, line },
      exists: true,
      excerpt: line === null || flagged === null ? '' : this.excerpt(lines, line),
      lineText: flagged,
      origin,
      wroteBy: line === null || flagged === null || origin === 'unit' ? [] : this.blamed(file, line),
      lastCommits: this.commits(['-n', String(LAST_COMMITS), '--', `:(top,literal)${file}`]),
    }
  }

  private inside(path: string, cwd: string): string | null {
    const inside = relative(this.top, realPath(resolve(cwd, path)))

    if (inside === '') return '.'

    return inside.split(sep)[0] === '..' || isAbsolute(inside) ? null : inside
  }

  // null when nothing is there; a folder has no line.
  private lines(file: string): string[] | null {
    try {
      const path = join(this.top, file)

      if (!statSync(path).isFile()) return []

      const lines = readFileSync(path, 'utf8').split(/\r?\n/)

      return lines.at(-1) === '' ? lines.slice(0, -1) : lines
    } catch {
      return null
    }
  }

  // Without a line the place is a whole file: one the unit changed holds lines of both kinds.
  private origin(file: string, line: number | null): PlaceContext['origin'] {
    const ranges = this.written?.(file) ?? null

    if (ranges === null) return 'unknown'
    if (ranges.length === 0) return 'before'
    if (line === null) return 'unknown'

    return ranges.some(([from, to]) => line >= from && line <= to) ? 'unit' : 'before'
  }

  private excerpt(lines: readonly string[], line: number): string {
    const first = Math.max(1, line - AROUND)
    const last = Math.min(lines.length, line + AROUND)
    const width = String(last).length

    return lines
      .slice(first - 1, last)
      .map((text, index) => `${String(first + index).padStart(width)}  ${text}`)
      .join('\n')
  }

  // Asked about the file as it is, so that the line is the one that was flagged whatever was written above it since
  // HEAD: a line nobody committed has no commit.
  private blamed(file: string, line: number): CommitNote[] {
    const [commit = ''] = this.git(['blame', '--porcelain', '-L', `${String(line)},${String(line)}`, '--', file]).split(/\s/)

    return commit === '' || NOT_COMMITTED.test(commit) ? [] : this.commits(['-n', '1', commit])
  }

  private commits(args: readonly string[]): CommitNote[] {
    return this.git(['log', NOTE, ...args])
      .split('\n')
      .flatMap((row) => {
        const [hash = '', date = '', subject = ''] = row.split(FIELD)

        return hash === '' ? [] : [{ hash, date, subject }]
      })
  }

  // Whatever git cannot tell is left empty: a flag is never lost for that.
  private git(args: readonly string[]): string {
    try {
      return this.repo.git(args)
    } catch {
      return ''
    }
  }
}
