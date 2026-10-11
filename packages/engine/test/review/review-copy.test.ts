import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, test } from 'vitest'
import { ReviewCopy } from '../../src/review/workspace/review-copy.ts'
import { git, makeRepo, writeFiles } from '../fixtures/repo.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-copy-'))
const repo = makeRepo(join(scratch, 'project'), { 'src/a.ts': 'export const a = 1\n', '.gitignore': 'node_modules/\n' })
const root = join(scratch, 'copies')

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

test('the copy holds the working tree as it stands, ignored files included, without Weaver’s state and without a remote', () => {
  writeFiles(repo.top, {
    'src/a.ts': 'export const a = 2\n',
    'node_modules/dep/index.js': 'module.exports = 1\n',
    '.git/weaver/sessions/s/state.json': '{}',
  })
  git(repo.top, ['remote', 'add', 'origin', 'https://example.com/project.git'])

  const copy = ReviewCopy.reserve(repo, root)

  copy.fill()

  assert.equal(readFileSync(join(copy.path, 'src/a.ts'), 'utf8'), 'export const a = 2\n')
  assert.equal(existsSync(join(copy.path, 'node_modules/dep/index.js')), true)
  assert.equal(existsSync(join(copy.path, '.git/weaver')), false)
  assert.equal(git(copy.path, ['remote']), '')
  assert.equal(git(repo.top, ['remote']), 'origin', 'the project keeps its own')
  assert.equal(git(copy.path, ['status', '--short']), 'M src/a.ts')

  copy.discard()
  assert.equal(existsSync(copy.path), false)
})

test('a project has a few places for its copies, always the same: a second review at the same time takes the next one', () => {
  const first = ReviewCopy.reserve(repo, root)
  const second = ReviewCopy.reserve(repo, root)

  assert.match(basename(first.path), /^project-[0-9a-f]{10}-1$/)
  assert.match(basename(second.path), /^project-[0-9a-f]{10}-2$/)

  first.discard()
  assert.equal(ReviewCopy.reserve(repo, root).path, first.path, 'a place that was given back is taken again')
  second.discard()
  rmSync(first.path, { recursive: true })
})

test('a copy left behind by a review that died is cleared after a day', () => {
  const abandoned = ReviewCopy.reserve(repo, root)
  const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000)

  writeFileSync(join(abandoned.path, 'leftover.txt'), 'x')
  utimesSync(abandoned.path, yesterday, yesterday)

  const next = ReviewCopy.reserve(repo, root)

  assert.equal(next.path, abandoned.path)
  assert.equal(existsSync(join(next.path, 'leftover.txt')), false)
  next.discard()
})

test('a working tree whose history is kept elsewhere gives a copy with no history, so that the copy cannot reach it', () => {
  const linked = join(scratch, 'linked')

  git(repo.top, ['worktree', 'add', '-q', linked, '-b', 'side'])

  const copy = new ReviewCopy({ ...repo, top: linked } as never, join(root, 'linked-copy'))

  mkdirSync(copy.path, { recursive: true })
  copy.fill()

  assert.equal(existsSync(join(copy.path, 'src/a.ts')), true)
  assert.equal(existsSync(join(copy.path, '.git')), false)
  copy.discard()
})

test('a reviewer’s own hook is told its copy in its arguments', () => {
  assert.equal(ReviewCopy.fromArguments(['PreToolUse', '--agent=claude', ReviewCopy.flag('/cache/copy-1')]), '/cache/copy-1')
  assert.equal(ReviewCopy.fromArguments(['PreToolUse', '--agent=claude']), null)
})
