import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { Repository } from '../../../src/lib/git/repository.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-alternates-'))

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

for (const snapshots of [false, true]) {
  test(`a temporary object store resolves repository objects and existing snapshots (snapshots: ${String(snapshots)})`, () => {
    const top = join(scratch, `repository with "quotes" ${String(snapshots)}`)
    mkdirSync(top)
    const git = (args: string[], objectStore?: string) => {
      const env = { ...process.env }
      delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES
      delete env.GIT_OBJECT_DIRECTORY
      if (objectStore !== undefined) env.GIT_OBJECT_DIRECTORY = objectStore
      return execFileSync('git', ['-C', top, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    }
    git(['init', '-q'])
    const file = join(top, 'file.txt')
    writeFileSync(file, 'committed')
    const committed = git(['hash-object', '-w', file])
    const commonDir = join(top, '.git')
    const persistent = join(commonDir, 'weaver/objects')
    let base = committed
    if (snapshots) {
      mkdirSync(persistent, { recursive: true })
      writeFileSync(file, 'snapshot')
      base = git(['hash-object', '-w', file], persistent)
    }
    const temporary = join(scratch, `temporary-${String(snapshots)}`, 'objects')
    const repo = new Repository(top, join(commonDir, 'worktrees/linked'), commonDir, temporary)

    assert.deepEqual(
      readFileSync(join(temporary, 'info/alternates'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as string),
      [...(snapshots ? [persistent] : []), join(commonDir, 'objects')],
    )
    assert.equal(git(['cat-file', '-p', committed], repo.objectStore), 'committed')
    assert.equal(git(['cat-file', '-p', base], repo.objectStore), snapshots ? 'snapshot' : 'committed')
  })
}
