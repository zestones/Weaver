import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { WorkingTreeSnapshot } from '../../src/lib/git/working-tree-snapshot.ts'
import { BaseTree } from '../../src/unit-of-work/diff/base-tree.ts'
import { UnitDiff } from '../../src/unit-of-work/diff/unit-diff.ts'
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

test('restoring HEAD is still a change against a unit that started with different uncommitted content', () => {
  const repo = makeRepo(join(scratch, 'restored'), { 'a.sql': '    AND retired_at IS NULL;\n' })
  const { dir } = new Session(repo, 's', 'claude')
  writeFiles(repo.top, { 'a.sql': 'AND retired_at IS NULL;\n' })
  const base = repo.hashPaths(['a.sql']).get('a.sql') ?? null
  writeFiles(repo.top, { 'a.sql': '    AND retired_at IS NULL;\n' })
  const unit = UnitDiff.of(repo, dir, { 'a.sql': { base, last: null, foreign: false, touchedAt: '', since: '' } }, [])
  assert.deepEqual(unit.paths, ['a.sql'])
  assert.deepEqual(unit.files[0]?.added, [[1, 1]])
  assert.equal(git(repo.top, ['diff', 'HEAD']), '')
  assert.equal(repo.git(['show', `${unit.base}:a.sql`]), 'AND retired_at IS NULL;')
})

test('review patches name oversized generated diffs and still inline small source changes', () => {
  const repo = makeRepo(join(scratch, 'large-review'), { 'a.ts': 'const a = 1\n', 'asset.json': '{}\n' })
  const { dir } = new Session(repo, 's', 'claude')
  const before = repo.hashPaths(['a.ts', 'asset.json'])
  writeFiles(repo.top, { 'a.ts': 'const a = 2\n', 'asset.json': JSON.stringify({ data: 'x'.repeat(1_000_000) }) })
  const files = Object.fromEntries(
    [...before].map(([path, base]) => [path, { base, last: null, foreign: false, touchedAt: '', since: '' }]),
  )
  const patch = UnitDiff.of(repo, dir, files, []).patch()
  assert.ok(Buffer.byteLength(patch) < 1000)
  assert.match(patch, /asset.json[\s\S]*Patch omitted: \d+ bytes/)
  assert.match(patch, /const a = 2/)
})
