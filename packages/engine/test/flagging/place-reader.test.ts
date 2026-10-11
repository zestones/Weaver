import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, test } from 'vitest'
import { PlaceReader } from '../../src/flagging/places/place-reader.ts'
import type { Repository } from '../../src/lib/git/repository.ts'
import { git, makeRepo, writeFiles } from '../fixtures/repo.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-places-'))
const TOKEN = 'src/auth/token.ts'
const TEN_LINES = Array.from({ length: 10 }, (_, index) => `const line${String(index + 1)} = ${String(index + 1)}`)
let repo: Repository

const commit = (message: string): string => {
  git(repo.top, ['add', '-A'])
  git(repo.top, ['commit', '-qm', message])

  return git(repo.top, ['rev-parse', '--short', 'HEAD'])
}

beforeAll(() => {
  repo = makeRepo(join(scratch, 'repo'), { [TOKEN]: `${TEN_LINES.join('\n')}\n`, 'docs/notes.md': '# Notes\n' })
})

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

test('a flagged line is kept with the three lines before it and the three after, each with its number', () => {
  const reader = new PlaceReader(repo)
  const middle = reader.read(`${TOKEN}:8`, repo.top)
  const first = reader.read(`${TOKEN}:1`, repo.top)

  assert.deepEqual(middle.place, { file: TOKEN, line: 8 })
  assert.equal(middle.exists, true)
  assert.equal(middle.lineText, 'const line8 = 8')
  assert.equal(
    middle.excerpt,
    [
      ' 5  const line5 = 5',
      ' 6  const line6 = 6',
      ' 7  const line7 = 7',
      ' 8  const line8 = 8',
      ' 9  const line9 = 9',
      '10  const line10 = 10',
    ].join('\n'),
  )
  assert.equal(first.excerpt, ['1  const line1 = 1', '2  const line2 = 2', '3  const line3 = 3', '4  const line4 = 4'].join('\n'))
})

test('a place without a line, a line past the end of the file and a folder keep no line', () => {
  const reader = new PlaceReader(repo)

  for (const place of [TOKEN, `${TOKEN}:99`, 'src/auth']) {
    const { exists, excerpt, lineText, wroteBy } = reader.read(place, repo.top)

    assert.deepEqual([exists, excerpt, lineText, wroteBy], [true, '', null, []], place)
  }
})

test('a path is read from where the command runs and named from the top of the repository', () => {
  const reader = new PlaceReader(repo)

  assert.deepEqual(reader.read('token.ts:2', join(repo.top, 'src/auth')).place, { file: TOKEN, line: 2 })
  assert.deepEqual(reader.read('../../docs/notes.md', join(repo.top, 'src/auth')).place, { file: 'docs/notes.md', line: null })
  assert.deepEqual(reader.read(join(repo.top, TOKEN), '/').place, { file: TOKEN, line: null })
})

test('a file that is not there is kept as a place all the same, and a path outside the repository as it was written', () => {
  const reader = new PlaceReader(repo, () => [])
  const gone = reader.read('src/auth/gone.ts:4', repo.top)
  const outside = reader.read('../elsewhere/x.ts:3', repo.top)
  const nothing = { exists: false, excerpt: '', lineText: null, origin: 'unknown', wroteBy: [], lastCommits: [] }

  assert.deepEqual(gone, { place: { file: 'src/auth/gone.ts', line: 4 }, ...nothing })
  assert.deepEqual(outside, { place: { file: '../elsewhere/x.ts', line: 3 }, ...nothing })
})

test('where the lines come from is told from what the unit of work wrote: before it, from it, or unknown', () => {
  const origin = (place: string, written?: () => readonly (readonly [number, number])[] | null) =>
    new PlaceReader(repo, written).read(place, repo.top).origin

  assert.equal(
    origin(`${TOKEN}:3`, () => [[2, 4]]),
    'unit',
  )
  assert.equal(
    origin(`${TOKEN}:5`, () => [[2, 4]]),
    'before',
  )
  assert.equal(
    origin(`${TOKEN}:5`, () => []),
    'before',
    'a file the unit did not change',
  )
  assert.equal(
    origin(TOKEN, () => []),
    'before',
  )
  assert.equal(
    origin(TOKEN, () => [[2, 4]]),
    'unknown',
    'a whole file the unit changed holds lines of both kinds',
  )
  assert.equal(
    origin(`${TOKEN}:5`, () => null),
    'unknown',
    'the diff of the unit could not be read',
  )
  assert.equal(origin(`${TOKEN}:5`), 'unknown', 'the owner flags outside any unit of work')
})

test('the commit that wrote the flagged line and the last three commits of the file are kept, the line as the file holds it now', () => {
  let lines = [...TEN_LINES]
  const hashes = ['second', 'third', 'fourth'].map((word, index) => {
    lines = lines.map((line, at) => (at === index ? `${line} // ${word}` : line))
    writeFiles(repo.top, { [TOKEN]: `${lines.join('\n')}\n` })

    return commit(`fix: the ${word} change`)
  })
  const initial = git(repo.top, ['rev-parse', '--short', 'HEAD~3'])

  // Two lines nobody committed, above the others: every line below moves down by two.
  writeFiles(repo.top, { [TOKEN]: `// not committed\n// yet\n${lines.join('\n')}\n` })

  const reader = new PlaceReader(repo, () => [])
  const changed = reader.read(`${TOKEN}:5`, repo.top)
  const old = reader.read(`${TOKEN}:12`, repo.top)
  const named = (commits: readonly { hash: string; subject: string }[]) => commits.map(({ hash, subject }) => [hash, subject])

  assert.equal(changed.lineText, 'const line3 = 3 // fourth')
  assert.deepEqual(named(changed.wroteBy), [[hashes[2], 'fix: the fourth change']])
  assert.match(changed.wroteBy[0]?.date ?? '', /^\d{4}-\d{2}-\d{2}$/)
  assert.deepEqual(named(old.wroteBy), [[initial, 'initial']], 'blamed where the line is now')
  assert.deepEqual(named(old.lastCommits), [
    [hashes[2], 'fix: the fourth change'],
    [hashes[1], 'fix: the third change'],
    [hashes[0], 'fix: the second change'],
  ])
  assert.deepEqual(reader.read(`${TOKEN}:1`, repo.top).wroteBy, [], 'a line nobody committed has no commit')
  assert.deepEqual(new PlaceReader(repo, () => [[5, 5]]).read(`${TOKEN}:5`, repo.top).wroteBy, [], 'a line the unit wrote is not looked up')

  writeFiles(repo.top, { 'src/new.ts': 'export const fresh = 1\n' })

  const untracked = reader.read('src/new.ts:1', repo.top)

  assert.deepEqual(
    [untracked.exists, untracked.lineText, untracked.wroteBy, untracked.lastCommits],
    [true, 'export const fresh = 1', [], []],
  )
})
