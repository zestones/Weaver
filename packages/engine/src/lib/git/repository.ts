import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export type Blob = string | null

export interface TreeEntry {
  readonly mode: string
  readonly blob: string
}

interface GitOptions {
  readonly index?: string
  readonly input?: string
}

const MAX_BUFFER = 256 * 1024 * 1024
// Keeps read commands such as `git status` from rewriting the owner's index.
const BASE_ENV = { GIT_OPTIONAL_LOCKS: '0' }

export class Repository {
  static readonly REGULAR_MODE = '100644'

  readonly top: string
  readonly gitDir: string
  readonly commonDir: string

  constructor(top: string, gitDir: string, commonDir: string) {
    this.top = top
    this.gitDir = gitDir
    this.commonDir = commonDir
  }

  static locate(cwd: string): Repository | null {
    try {
      const output = execFileSync(
        'git',
        ['-C', cwd, 'rev-parse', '--path-format=absolute', '--show-toplevel', '--absolute-git-dir', '--git-common-dir'],
        { encoding: 'utf8', env: { ...process.env, ...BASE_ENV }, stdio: ['ignore', 'pipe', 'ignore'] },
      )
      const [top, gitDir, commonDir] = output.trim().split('\n')

      return top !== undefined && gitDir !== undefined && commonDir !== undefined ? new Repository(top, gitDir, commonDir) : null
    } catch {
      return null
    }
  }

  get stateDir(): string {
    return join(this.commonDir, 'weaver')
  }

  // Snapshot objects go to a store layered over the repository's own, so `.git/objects` never grows.
  get objectStore(): string {
    return join(this.stateDir, 'objects')
  }

  git(args: readonly string[], options: GitOptions = {}): string {
    return execFileSync('git', ['-C', this.top, ...args], {
      encoding: 'utf8',
      env: this.env(options.index),
      input: options.input,
      maxBuffer: MAX_BUFFER,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trimEnd()
  }

  env(index?: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...BASE_ENV,
      GIT_OBJECT_DIRECTORY: this.objectStore,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: join(this.commonDir, 'objects'),
    }

    mkdirSync(this.objectStore, { recursive: true })
    if (index === undefined) delete env.GIT_INDEX_FILE
    else env.GIT_INDEX_FILE = index

    return env
  }

  head(): string | null {
    try {
      return this.git(['rev-parse', '--verify', '-q', 'HEAD']) || null
    } catch {
      return null
    }
  }

  // Every blob is written to the object store, so that it can be read back after the file changed again.
  hashPaths(paths: readonly string[]): Map<string, Blob> {
    const present = paths.filter((path) => this.isFile(path))
    const hashes =
      present.length === 0 ? [] : this.git(['hash-object', '-w', '--stdin-paths'], { input: `${present.join('\n')}\n` }).split('\n')
    const hashed = new Map(present.map((path, index) => [path, hashes[index] ?? null]))

    return new Map(paths.map((path) => [path, hashed.get(path) ?? null]))
  }

  treeEntries(tree: string, paths: readonly string[]): Map<string, TreeEntry> {
    const entries = new Map<string, TreeEntry>()

    if (paths.length === 0) return entries

    for (const record of this.git(['ls-tree', '-z', tree, '--', ...paths]).split('\0')) {
      const match = /^(\d+) blob ([0-9a-f]+)\t(.+)$/.exec(record)

      if (match?.[3] !== undefined) entries.set(match[3], { mode: match[1] ?? Repository.REGULAR_MODE, blob: match[2] ?? '' })
    }

    return entries
  }

  blobsAt(tree: string, paths: readonly string[]): Map<string, Blob> {
    const entries = this.treeEntries(tree, paths)

    return new Map(paths.map((path) => [path, entries.get(path)?.blob ?? null]))
  }

  dirtyPaths(): string[] {
    const records = this.git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']).split('\0')

    return records.filter((record) => record.length > 3).map((record) => record.slice(3))
  }

  private isFile(path: string): boolean {
    const absolute = join(this.top, path)

    return existsSync(absolute) && !lstatSync(absolute).isDirectory()
  }
}
