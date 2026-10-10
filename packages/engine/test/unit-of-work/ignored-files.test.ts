import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import { WorkingTreeSnapshot } from '../../src/lib/git/working-tree-snapshot.ts'
import { BaseTree } from '../../src/unit-of-work/diff/base-tree.ts'
import { UnitDiff } from '../../src/unit-of-work/diff/unit-diff.ts'
import { Session } from '../../src/unit-of-work/session/session.ts'
import { SAMPLE_REPO, git, makeRepo, writeFiles } from '../fixtures/repo.ts'
import { A_FILE, agentRuns, agentWrites, finishWith, PASSING, prompt, stateOf, stubChecks, unitFiles } from '../fixtures/session.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-ignored-files-'))
const CACHE_FILE = '.cache/agents/draft.py'
const IGNORES = 'ignored/\n.cache/\n'
let session: Session
let counter = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  session = new Session(makeRepo(join(scratch, `repo-${String(counter)}`), { ...SAMPLE_REPO, '.gitignore': IGNORES }), 's', 'claude')
})

const snapshot = (): string => new WorkingTreeSnapshot(session.repo, session.dir).tree()

function checkedFiles(): string[] {
  const index = readFileSync(join(session.repo.gitDir, 'index'))
  const diff = UnitDiff.of(session.repo, session.dir, stateOf(session)?.unit.files ?? {}, [])

  assert.deepEqual(readFileSync(join(session.repo.gitDir, 'index')), index)

  return diff.files.map((file) => `${file.status} ${file.path}`)
}

test('editing existing and new ignored cache files leaves the checked diff empty', () => {
  writeFiles(session.repo.top, { [CACHE_FILE]: 'before\n' })
  prompt(session, 'prepare scratch files')
  agentWrites(session, { [CACHE_FILE]: 'after\n', '.cache/agents/new.py': 'new\n' })

  assert.deepEqual(unitFiles(session), [CACHE_FILE, '.cache/agents/new.py'], 'touch attribution is retained')
  assert.deepEqual(checkedFiles(), [])
})

test('a unit of ignored files only gives the checks nothing to look at, and settles', async () => {
  writeFiles(session.repo.top, { [CACHE_FILE]: 'before\n' })
  prompt(session, 'prepare a scratch file')
  agentWrites(session, { [CACHE_FILE]: 'after\n' })

  const checks = stubChecks([PASSING])

  await finishWith(session, checks)

  assert.deepEqual(checks.seen, [[]])
  assert.deepEqual(unitFiles(session), [])
})

test('a tracked file matching an ignore rule still has its edit checked', () => {
  writeFiles(session.repo.top, { [CACHE_FILE]: 'before\n' })
  git(session.repo.top, ['add', '--force', '--', CACHE_FILE])
  git(session.repo.top, ['commit', '-qm', 'tracked scratch'])
  prompt(session, 'change the tracked file')
  agentWrites(session, { [CACHE_FILE]: 'after\n' })

  assert.deepEqual(checkedFiles(), [`M ${CACHE_FILE}`])
})

test('an ignored file newly staged by the owner is included even after the session index was seeded', () => {
  const untracked = '.cache/agents/untracked.py'

  snapshot()
  writeFiles(session.repo.top, { [CACHE_FILE]: 'before\n', [untracked]: 'scratch\n' })
  git(session.repo.top, ['add', '--force', '--', CACHE_FILE])
  prompt(session, 'change the newly tracked file')
  agentWrites(session, { [CACHE_FILE]: 'after\n' })

  assert.deepEqual(checkedFiles(), [`M ${CACHE_FILE}`])
  assert.deepEqual([...session.repo.treeEntries(snapshot(), [CACHE_FILE, untracked]).keys()], [CACHE_FILE])
})

test('a tracked deletion stays checked after index removal and a new matching ignore rule', () => {
  prompt(session, 'remove the source')
  agentRuns(session, `rm ${A_FILE}`, () => {
    rmSync(join(session.repo.top, A_FILE))
  })
  git(session.repo.top, ['rm', '--cached', '--', A_FILE])
  writeFiles(session.repo.top, { '.gitignore': IGNORES + A_FILE + '\n' })

  assert.deepEqual(checkedFiles(), [`D ${A_FILE}`])
})

test('a script deletion of an untracked visible file remains a real deletion', () => {
  const path = 'notes.txt'

  writeFiles(session.repo.top, { [path]: 'before\n' })
  prompt(session, 'remove the notes')
  agentRuns(session, `rm ${path}`, () => {
    rmSync(join(session.repo.top, path))
  })

  assert.deepEqual(checkedFiles(), [`D ${path}`])
})

test('a failed Git ignore query cannot silently drop unit files', () => {
  const files = { '../outside.py': { base: null, last: null, foreign: false, touchedAt: '' } }

  assert.throws(() => new BaseTree(session.repo, session.dir).of(snapshot(), files), /Cannot classify ignored unit files/)
})
