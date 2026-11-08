import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test, vi } from 'vitest'
import { InstalledRelease } from '../../src/lib/releases/installed-release.ts'
import { Loop } from '../../src/loop/dispatch/loop.ts'
import { ReleaseNotice } from '../../src/loop/exchange/release-notice.ts'
import { Session } from '../../src/unit-of-work/session/session.ts'
import { declarationFiles } from '../fixtures/declaration.ts'
import { makeRepo } from '../fixtures/repo.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-notice-'))

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

test('a release notice is persisted without resetting old state, pending calls or work', () => {
  const repo = makeRepo(join(scratch, 'preserved'), { file: 'one' })
  const session = new Session(repo, 'owner', 'claude')

  session.watch('call', { tool: 'Write', targets: ['file'], scope: 'all', untilStop: false, agent: null })
  const before = session.state()
  const installed = new InstalledRelease()

  const compared = vi.spyOn(installed, 'laterThan').mockReturnValue('0.10.0')
  const notice = new ReleaseNotice(installed, '0.9.5')

  assert.match(notice.forSession(session) ?? '', /Tell the owner to run weaver update in this project/)
  assert.deepEqual(session.state(), { ...before, releaseChecked: true })
  assert.equal(notice.forSession(new Session(repo, 'owner', 'claude')), null)
  assert.equal(compared.mock.calls.length, 1)
})

test('only an owner request records the release comparison, even when no newer release exists', async () => {
  const repo = makeRepo(join(scratch, 'owner-only'), declarationFiles({}))
  const loop = new Loop()
  const hook = (payload: object) =>
    loop.handle('UserPromptSubmit', ['--agent=claude'], JSON.stringify({ cwd: repo.top, session_id: 'session', ...payload }))

  await hook({ prompt: 'subtask', agent_id: 'child' })
  assert.equal(new Session(repo, 'session', 'claude').state()?.releaseChecked, undefined)
  await hook({ prompt: 'please work' })
  assert.equal(new Session(repo, 'session', 'claude').state()?.releaseChecked, true)
})
