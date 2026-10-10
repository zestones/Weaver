import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, test } from 'vitest'
import type { Repository } from '../../../src/lib/git/repository.ts'
import { TreeDiff } from '../../../src/lib/git/tree-diff.ts'
import { WorkingTreeSnapshot } from '../../../src/lib/git/working-tree-snapshot.ts'
import { SAMPLE_REPO, git, makeRepo, writeFiles } from '../../fixtures/repo.ts'

const untilNextSecond = (margin: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 1000 - (Date.now() % 1000) + margin))

const scratch = mkdtempSync(join(tmpdir(), 'weaver-snapshot-'))
let repo: Repository
let counter = 0

beforeEach(() => {
  counter += 1
  repo = makeRepo(join(scratch, `repo-${String(counter)}`), SAMPLE_REPO)
})

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

function snapshot(name: string): string {
  const dir = join(scratch, `repo-${String(counter)}-${name}`)

  mkdirSync(dir, { recursive: true })

  return new WorkingTreeSnapshot(repo, dir).tree()
}

const looseObjects = (): number =>
  readdirSync(join(repo.gitDir, 'objects'))
    .filter((entry) => /^[0-9a-f]{2}$/.test(entry))
    .reduce((sum, entry) => sum + readdirSync(join(repo.gitDir, 'objects', entry)).length, 0)

describe('the snapshot of the working tree', () => {
  test('includes untracked files, skips ignored ones, and leaves the user index and object store alone', () => {
    const index = readFileSync(join(repo.gitDir, 'index'))
    const objects = looseObjects()

    writeFiles(repo.top, { 'src/b.ts': 'export const b = 2\n', 'ignored/out.txt': 'x\n' })

    const tree = snapshot('s1')
    const files = new TreeDiff(repo, git(repo.top, ['rev-parse', 'HEAD^{tree}']), tree).files([])

    assert.deepEqual(
      files.map((file) => `${file.status} ${file.path}`),
      ['A src/b.ts'],
    )
    assert.deepEqual(files[0]?.added, [[1, 1]])
    assert.ok(readFileSync(join(repo.gitDir, 'index')).equals(index))
    assert.equal(looseObjects(), objects)
    assert.equal(git(repo.top, ['status', '--porcelain']), '?? src/b.ts')
  })

  test('a folder the project excludes stays out of the diff: none of it is listed, but it is counted', () => {
    writeFiles(repo.top, {
      'design/lab/plugin/code.js': 'bundle()\n',
      'design/lab/docs/brief.md': '# Brief\n',
      'src/b.ts': 'export const b = 2\n',
    })

    const base = git(repo.top, ['rev-parse', 'HEAD^{tree}'])
    const diff = new TreeDiff(repo, base, snapshot('lab'))

    assert.deepEqual(
      diff.files(['design/lab']).map((file) => file.path),
      ['src/b.ts'],
    )
    assert.deepEqual(diff.excludedFolders(['design/lab']), [{ folder: 'design/lab', files: 2 }])
    assert.equal(diff.files([]).length, 3)
  })

  test('an emptied object store costs the index, not the snapshot', () => {
    writeFiles(repo.top, { 'src/b.ts': 'export const b = 2\n' })

    const first = snapshot('wiped')

    rmSync(repo.objectStore, { recursive: true, force: true })

    assert.equal(snapshot('wiped'), first)
    assert.equal(repo.git(['cat-file', '-t', first]), 'tree')
  })

  test('an edit of the same size made in the second the owner’s index recorded the file is in the snapshot', async () => {
    await untilNextSecond(20)
    writeFiles(repo.top, { 'src/a.ts': 'export const a = 2\n' })
    git(repo.top, ['commit', '-qam', 'two'])
    writeFiles(repo.top, { 'src/a.ts': 'export const a = 3\n' })
    await untilNextSecond(50)

    assert.equal(repo.git(['show', `${snapshot('same-second')}:src/a.ts`]), 'export const a = 3')
  })
})
