import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { WorkingTreeSnapshot } from '../../src/lib/git/working-tree-snapshot.ts'
import { BaseTree } from '../../src/unit-of-work/diff/base-tree.ts'
import { Session } from '../../src/unit-of-work/session/session.ts'
import { git, makeRepo, writeFiles } from '../fixtures/repo.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-base-tree-'))

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

test("the base tree puts back only the unit's files, so what others changed never shows in its diff", () => {
  const repo = makeRepo(join(scratch, 'repo'), { 'a.txt': 'a\n', 'b.txt': 'b\n' })
  const { dir } = new Session(repo, 's', 'claude')
  const before = repo.hashPaths(['a.txt', 'new.txt'])

  writeFiles(repo.top, { 'a.txt': 'agent\n', 'new.txt': 'agent\n', 'b.txt': 'owner\n' })

  const head = new WorkingTreeSnapshot(repo, dir).tree()
  const files = {
    'a.txt': { base: before.get('a.txt') ?? null, last: null, foreign: false, touchedAt: '', since: '' },
    'new.txt': { base: before.get('new.txt') ?? null, last: null, foreign: false, touchedAt: '', since: '' },
  }
  const base = new BaseTree(repo, dir).of(head, files)

  assert.deepEqual(repo.git(['diff', '--name-status', base, head]).split('\n'), ['M\ta.txt', 'A\tnew.txt'])
  assert.equal(git(repo.top, ['status', '--porcelain']).split('\n').length, 3, 'the real index is left alone')
})
