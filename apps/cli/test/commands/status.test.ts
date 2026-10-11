import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Repository, ReviewLedger } from '@weaver/engine'
import { afterAll, test } from 'vitest'
import { makeProject, weaver, writeConfig } from '../fixtures/project.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-status-'))
const top = makeProject(join(scratch, 'project'))
const point = (id: string, fields: Record<string, unknown> = {}) => ({
  id,
  rule: 'T10',
  file: 'src/a.ts',
  line: 28,
  message: 'casts external data',
  standing: 'not fixed by the agent: the owner asked for it',
  session: 's',
  at: '2026-10-11T00:00:00.000Z',
  ...fields,
})

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

test('status lists what the reviews left for the owner, and close takes a point off the list', () => {
  const repo = Repository.locate(top)

  assert.deepEqual(weaver(top, ['status']), { status: 0, lines: ['Nothing waits for you.'] })
  if (repo === null) throw new Error('the project is a repository')

  new ReviewLedger(repo).open([
    point('3f9a2c1/F1'),
    point('3f9a2c1/S1', {
      rule: 'weaver:suspicion',
      line: null,
      message: 'the cache may be stale',
      standing: 'suspected by the reviewer, not verified',
    }),
  ])

  assert.deepEqual(weaver(top, ['status']).lines, [
    '2 point(s) wait for you:',
    '  3f9a2c1/F1  T10 src/a.ts:28: casts external data',
    '      not fixed by the agent: the owner asked for it',
    '  3f9a2c1/S1  weaver:suspicion src/a.ts: the cache may be stale',
    '      suspected by the reviewer, not verified',
    'Close one with: weaver close <id> fixed|wontfix|issue [note]',
  ])
  assert.deepEqual(weaver(top, ['close', '3f9a2c1/F1', 'wontfix', 'compared', 'on', 'purpose']), {
    status: 0,
    lines: ['3f9a2c1/F1 closed as wontfix.'],
  })
  assert.equal(weaver(top, ['status']).lines[0], '1 point(s) wait for you:')
})

test('closing a point as an issue files it with the command the project names, and keeps the point open when that fails', () => {
  const repo = Repository.locate(top)
  const filer = join(scratch, 'file-issue.mjs')

  if (repo === null) throw new Error('the project is a repository')

  new ReviewLedger(repo).open([point('77aa001/F1'), point('77aa001/F2')])
  writeFileSync(
    filer,
    `if (process.argv[2].includes('F2')) { console.error('no network'); process.exit(1) }\nconsole.log('https://issues.example/42 ' + JSON.stringify(process.argv[3]))\n`,
  )
  writeConfig(top, { settings: { version: 1 }, reviewers: { runtime: 'codex', issue: ['node', filer, '{body}', '{title}'] } })

  const filed = weaver(top, ['close', '77aa001/F1', 'issue', 'for', 'later'])

  assert.deepEqual(filed, {
    status: 0,
    lines: ['77aa001/F1 closed as issue: https://issues.example/42 "T10 src/a.ts:28: casts external data".'],
  })
  assert.deepEqual(weaver(top, ['close', '77aa001/F2', 'issue']), {
    status: 1,
    lines: ['the issue was not filed, and 77aa001/F2 stays open: no network'],
  })
  assert.ok(weaver(top, ['status']).lines.some((line) => line.startsWith('  77aa001/F2 ')))
})

test('close says what it could not do: a point that does not exist, one already closed, a word it does not know', () => {
  assert.deepEqual(weaver(top, ['close', 'nowhere/F9', 'fixed']), { status: 1, lines: ['no point is named nowhere/F9'] })
  assert.deepEqual(weaver(top, ['close', '3f9a2c1/F1', 'issue']), { status: 1, lines: ['3f9a2c1/F1 is already closed as wontfix'] })
  assert.deepEqual(weaver(top, ['close', '3f9a2c1/S1', 'later']), { status: 2, lines: ['weaver close <id> fixed|wontfix|issue [note]'] })
})
