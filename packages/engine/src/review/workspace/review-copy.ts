import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, statSync, utimesSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, relative } from 'node:path'
import type { Repository } from '../../lib/git/repository.ts'

const FLAG = '--review-copy='
const SLOTS = 8
const KEEP_MS = 24 * 60 * 60 * 1000

// The working tree as the unit left it, for a reviewer to run and write in. It lives outside the repository, so that
// nothing of it shows there, and on the same disk, where a copy that shares its blocks costs no space.
export class ReviewCopy {
  readonly path: string
  private readonly repo: Repository

  constructor(repo: Repository, path: string) {
    this.repo = repo
    this.path = path
  }

  // A project has a few places for its copies, always the same ones: an agent runtime keeps a note of every new folder
  // it writes in, and a new folder for each review would fill the owner's configuration with them.
  static reserve(repo: Repository, root: string = ReviewCopy.root()): ReviewCopy {
    const name = `${basename(repo.top)}-${createHash('sha1').update(repo.top).digest('hex').slice(0, 10)}`

    mkdirSync(root, { recursive: true })

    for (let slot = 1; slot <= SLOTS; slot += 1) {
      const path = join(root, `${name}-${String(slot)}`)

      try {
        if (ReviewCopy.isAbandoned(path)) ReviewCopy.remove(path)
      } catch {
        // What a copy holds may not be removable by its owner: the place is left as it is.
        continue
      }

      try {
        mkdirSync(path)

        return new ReviewCopy(repo, path)
      } catch {
        // Another review of this project is at work there.
      }
    }

    throw new Error(`${String(SLOTS)} reviews of this project are already at work in ${root}`)
  }

  static root(): string {
    return join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'weaver', 'review')
  }

  // A reviewer's own hook names its copy in its arguments: it is held there whatever folder it moves to.
  static flag(path: string): string {
    return `${FLAG}${path}`
  }

  static fromArguments(argv: readonly string[]): string | null {
    return argv.find((arg) => arg.startsWith(FLAG))?.slice(FLAG.length) ?? null
  }

  private static isAbandoned(path: string): boolean {
    const modified = statSync(path, { throwIfNoEntry: false })?.mtimeMs

    return modified !== undefined && Date.now() - modified > KEEP_MS
  }

  private static remove(path: string): void {
    try {
      rmSync(path, { recursive: true, force: true })
    } catch {
      // A tool may have left folders it made read-only.
      execFileSync('chmod', ['-R', 'u+rwX', path], { stdio: 'ignore' })
      rmSync(path, { recursive: true, force: true })
    }
  }

  // `cp -a` gives the copy the date of the project: its age counts from now.
  fill(): void {
    execFileSync('cp', ['-a', '--reflink=auto', '--no-target-directory', this.repo.top, this.path], { stdio: ['ignore', 'ignore', 'pipe'] })

    const now = new Date()

    utimesSync(this.path, now, now)
    this.dropState()
    this.dropRemotes()
  }

  discard(): void {
    ReviewCopy.remove(this.path)
  }

  // The copy is not a place Weaver supervises: what it knows of the sessions stays in the repository.
  private dropState(): void {
    for (const dir of new Set([this.repo.gitDir, this.repo.commonDir])) {
      const inside = relative(this.repo.top, dir)

      if (!inside.startsWith('..') && !isAbsolute(inside)) rmSync(join(this.path, inside, 'weaver'), { recursive: true, force: true })
    }
  }

  // Without a remote, nothing can be pushed from the copy. A working tree whose history is kept elsewhere would share
  // it with its copy, so that copy is left with no history at all.
  private dropRemotes(): void {
    const history = join(this.path, '.git')
    const kind = statSync(history, { throwIfNoEntry: false })

    if (kind?.isFile() === true) rmSync(history)
    if (kind?.isDirectory() !== true) return

    const git = (args: readonly string[]): string => execFileSync('git', ['-C', this.path, ...args], { encoding: 'utf8' })

    for (const remote of git(['remote'])
      .split('\n')
      .filter((name) => name !== ''))
      git(['remote', 'remove', remote])
  }
}
