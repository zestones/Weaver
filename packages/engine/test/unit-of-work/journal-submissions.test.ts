import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { Repository } from '../../src/lib/git/repository.ts'
import { Journal } from '../../src/unit-of-work/journal/journal.ts'

const dir = mkdtempSync(join(tmpdir(), 'weaver-submissions-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('version 3 answer submissions coexist with legacy answer and check events without rewriting them', () => {
  const journal = new Journal(new Repository(dir, join(dir, '.git'), join(dir, '.git')))
  const source = { session: 'one', agent: 'claude' }
  const answer = { kind: 'answer', unit: 1, finding: 1, rule: 'N1', status: 'fixed' } as const
  const current = journal.append(source, { ...answer, review: 'content', submission: 1, why: 'split it' })
  assert.equal(current.v, 3)
  const earlier = { v: 2, at: '2020-01-01T00:00:00Z', ...source, ...answer }
  appendFileSync(join(journal.dir, 'one.jsonl'), `${JSON.stringify(earlier)}\n`)
  const read = journal.readSession('one')
  assert.deepEqual(read[0], current)
  assert.deepEqual(read[1], { weaver: 'unknown', ...earlier })
})
