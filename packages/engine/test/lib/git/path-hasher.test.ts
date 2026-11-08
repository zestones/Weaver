import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test, vi } from 'vitest'
import { AttributionWindow } from '../../../src/unit-of-work/attribution/attribution-window.ts'
import { makeRepo, writeFiles } from '../../fixtures/repo.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-hashing-'))
const call = { tool: 'Bash', targets: null, scope: 'all', untilStop: false, agent: null } as const

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

test('only regular files reach hash-object; missing paths remain distinct from unsupported entries', async () => {
  const repo = makeRepo(join(scratch, 'kinds'), { regular: 'one' })

  mkdirSync(join(repo.top, 'folder'))
  for (const [name, target] of [
    ['file-link', 'regular'],
    ['folder-link', 'folder'],
    ['dangling', 'absent'],
  ]) {
    symlinkSync(target ?? '', join(repo.top, name ?? ''))
  }
  execFileSync('mkfifo', [join(repo.top, 'pipe')])
  const server = createServer()

  await new Promise<void>((resolve) => server.listen(join(repo.top, 'socket'), resolve))
  try {
    const spy = vi.spyOn(repo, 'git')
    const hashed = repo.hashPaths(['regular', 'folder', 'file-link', 'folder-link', 'dangling', 'pipe', 'socket', 'missing'])

    assert.equal(hashed.size, 2)
    assert.equal(hashed.get('missing'), null)
    assert.equal(hashed.get('regular')?.length, 40)
    assert.equal(repo.unavailable.size, 6)
    assert.deepEqual(
      spy.mock.calls.filter(([args]) => args[0] === 'hash-object').map(([, options]) => options?.input),
      ['"regular"\n'],
    )
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error === undefined ? resolve() : reject(error))))
  }
})

test('a required clean filter fails only its path; quotes, backslashes and newlines are hashed correctly', () => {
  const repo = makeRepo(join(scratch, 'batch'), { '.gitattributes': 'bad filter=broken\n', good: 'old' })

  repo.git(['config', 'filter.broken.clean', 'false'])
  repo.git(['config', 'filter.broken.required', 'true'])
  writeFiles(repo.top, { bad: 'bad', 'a"b\\c\nd': 'unusual' })
  const result = repo.hashPaths(['good', 'bad', 'a"b\\c\nd'])

  assert.equal(result.has('bad'), false)
  assert.equal(result.get('good')?.length, 40)
  assert.equal(result.get('a"b\\c\nd'), repo.git(['hash-object', '--', 'a"b\\c\nd']))
  assert.deepEqual([...repo.unavailable], ['bad'])
})

test('a path that vanishes during a failed batch is missing while the other paths survive', () => {
  const repo = makeRepo(join(scratch, 'vanished'), { good: 'one', gone: 'two' })
  const git = repo.git.bind(repo)

  vi.spyOn(repo, 'git').mockImplementation((args, options) => {
    if (args.includes('--stdin-paths')) rmSync(join(repo.top, 'gone'))

    return git(args, options)
  })
  const hashed = repo.hashPaths(['good', 'gone'])

  assert.equal(hashed.get('gone'), null)
  assert.equal(hashed.get('good')?.length, 40)
  assert.equal(repo.unavailable.size, 0)
})

test('unavailable baselines never become HEAD baselines or false deletions; excluded dirty paths stay out on reopen', () => {
  const repo = makeRepo(join(scratch, 'window'), { good: 'one', bad: 'two', '.local/file': 'old', '.locality': 'old' })

  writeFiles(repo.top, { '.local/file': 'excluded', '.locality': 'included' })
  rmSync(join(repo.top, 'bad'))
  symlinkSync('good', join(repo.top, 'bad'))
  const window = AttributionWindow.open(repo, call, ['.local/'])

  assert.ok(!('.local/file' in window.record.before))
  assert.deepEqual(window.record.unavailable, ['bad'])
  rmSync(join(repo.top, 'bad'))
  writeFiles(repo.top, { good: 'new', bad: 'back', '.local/file': 'still excluded', '.locality': 'changed' })
  const closed = window.close(repo, () => new Set())

  assert.deepEqual([...closed.charged.keys()].sort(), ['.locality', 'good'])
  assert.ok(!('.local/file' in window.reopened(repo).record.before))

  const next = AttributionWindow.open(repo, { ...call, targets: ['good'] })

  rmSync(join(repo.top, 'good'))
  symlinkSync('bad', join(repo.top, 'good'))
  assert.equal(next.close(repo, () => new Set()).charged.size, 0)
})
