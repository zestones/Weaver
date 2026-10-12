import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import type { Repository } from '../../src/lib/git/repository.ts'
import { RepositorySessions } from '../../src/unit-of-work/session/repository-sessions.ts'
import { Session } from '../../src/unit-of-work/session/session.ts'
import { SAMPLE_REPO, makeRepo, writeFiles } from '../fixtures/repo.ts'
import { prompt } from '../fixtures/session.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-sessions-'))

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

// A session that received a request, last seen at the minute given.
function seen(repo: Repository, id: string, agent: string, request: string, minute: number): Session {
  const session = new Session(repo, id, agent)
  const at = new Date(Date.UTC(2026, 9, 12, 14, minute))

  prompt(session, request)
  utimesSync(join(session.dir, 'state.json'), at, at)

  return session
}

test('the sessions of a repository are the ones that left a state this Weaver reads, the one seen last first', () => {
  const repo = makeRepo(join(scratch, 'listed'), SAMPLE_REPO)
  const sessions = new RepositorySessions(repo)

  assert.deepEqual(sessions.all(), [], 'a repository no agent worked in')

  seen(repo, '3f2a91c0-aaaa', 'claude', 'add the guard', 2)
  seen(repo, 'b81e77d2-bbbb', 'codex', 'fix the failing test', 14)
  new Session(repo, 'no-request-yet', 'claude')
  writeFiles(repo.top, { '.git/weaver/sessions/older-weaver/state.json': '{"version":5,"agent":"claude"}' })

  assert.deepEqual(
    sessions.all().map(({ id, agent, lastRequest }) => [id, agent, lastRequest]),
    [
      ['b81e77d2-bbbb', 'codex', 'fix the failing test'],
      ['3f2a91c0-aaaa', 'claude', 'add the guard'],
    ],
  )
  assert.deepEqual(
    sessions.startingWith('3f').map(({ id }) => id),
    ['3f2a91c0-aaaa'],
  )
  assert.deepEqual(sessions.startingWith('zz'), [])
  assert.deepEqual(sessions.underMaintenance(), [])

  sessions.startingWith('b8')[0]?.maintain(true)

  assert.deepEqual(
    sessions.underMaintenance().map(({ id }) => id),
    ['b81e77d2-bbbb'],
  )
})

test('a session is named by the first characters of its id that no other shares, eight at least', () => {
  const repo = makeRepo(join(scratch, 'named'), SAMPLE_REPO)
  const alone = new Session(repo, '0199a213-81c0-7800-8aa1-bbab2a035a53', 'codex')

  assert.equal(alone.shortId, '0199a213')

  const twin = new Session(repo, '0199a213-81f4-7a11-9c02-5d1e0c7f2b90', 'codex')

  assert.equal(alone.shortId, '0199a213-81c')
  assert.equal(twin.shortId, '0199a213-81f')
  assert.equal(new Session(repo, 's', 'claude').shortId, 's', 'an id shorter than that is its own name')
})
