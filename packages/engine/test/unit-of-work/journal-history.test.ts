import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test, vi } from 'vitest'
import { Repository } from '../../src/lib/git/repository.ts'
import { JournalHistory } from '../../src/unit-of-work/journal/journal-history.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-history-'))
const repo = new Repository(scratch, join(scratch, '.git'), join(scratch, '.git'))

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

test('history counts only recent errors, tolerates malformed lines, and refreshes when a journal grows', () => {
  const history = new JournalHistory(repo)
  const now = Date.now()
  const source = { session: 'one', agent: 'codex' }
  const error = { kind: 'error', event: 'Stop', message: 'failed' } as const

  history.journal.append(source, error, new Date(now - 8 * 86400000).toISOString())
  history.journal.append(source, error, new Date(now - 1).toISOString())
  appendFileSync(join(history.journal.dir, 'one.jsonl'), '{broken\nnull\n{}\n"text"\n')
  assert.equal(history.recentErrors(now).length, 1)
  history.journal.append(source, error, new Date(now).toISOString())
  assert.equal(history.recentErrors(now).length, 2)
  assert.equal(history.recentErrors(now + 8 * 86400000).length, 0)
})

test('only author hooks establish a runtime was wired, regardless of how old they are', () => {
  const history = new JournalHistory(repo)
  const hook = { kind: 'hook', event: 'PreToolUse', tool: 'Bash', subagent: 'child', ms: 1 } as const

  history.journal.append({ session: 'parent', agent: 'claude' }, hook)
  assert.equal(history.authorHook('claude'), null)
  history.journal.append({ session: 'parent', agent: 'claude' }, { ...hook, subagent: null }, '2020-01-01T00:00:00Z')
  assert.equal(history.authorHook('claude')?.session, 'parent')
  assert.equal(history.authorHook('codex'), null)
})

test('notification claims use the journal across instances, separately for Stop owner and agent delivery', () => {
  const history = new JournalHistory(repo)
  const source = { session: 'notice', agent: 'claude' }
  const notice = { kind: 'notification', event: 'Stop', message: 'broken', channel: 'owner' } as const
  const since = new Date(Date.now() - 600000).toISOString()

  assert.equal(history.journal.notify(source, notice, since), true)
  assert.equal(new JournalHistory(repo).journal.notify(source, notice, since), false)
  assert.equal(history.journal.notify(source, { ...notice, channel: 'agent' }, since), true)
  assert.equal(history.journal.notify({ ...source, session: 'different' }, notice, since), true)
  assert.equal(history.journal.notify(source, notice, new Date(Date.now() + 1).toISOString()), true)
})

test('watching reads only appended bytes and waits for an incomplete final line', () => {
  const separate = new Repository(scratch, join(scratch, 'watch'), join(scratch, 'watch'))
  const history = new JournalHistory(separate)
  const source = { session: 'watch', agent: 'claude' }
  const event = history.journal.append(source, { kind: 'error', event: 'Stop', message: 'one' })
  const read = vi.spyOn(history.journal, 'tail')

  assert.equal(history.recentErrors().length, 1)
  history.recentErrors()
  assert.equal(read.mock.calls.length, 1)
  const file = join(history.journal.dir, 'watch.jsonl')
  const next = JSON.stringify({ ...event, message: 'two' })
  const offset = statSync(file).size

  appendFileSync(file, next.slice(0, 20))
  assert.equal(history.recentErrors().length, 1)
  appendFileSync(file, `${next.slice(20)}\n`)
  assert.equal(history.recentErrors().length, 2)
  assert.equal(read.mock.calls.at(-1)?.[1], offset)
})
