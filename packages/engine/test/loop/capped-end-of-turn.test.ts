import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test, vi } from 'vitest'
import { Repository } from '../../src/lib/git/repository.ts'
import { UnitDiff } from '../../src/unit-of-work/diff/unit-diff.ts'
import { Session } from '../../src/unit-of-work/session/session.ts'
import { SessionStore } from '../../src/unit-of-work/session/session-store.ts'
import { UnitOfWork } from '../../src/unit-of-work/unit/unit-of-work.ts'
import { declaration, eventsOf, finishWith, PASSING, stubChecks } from '../fixtures/session.ts'

const dir = mkdtempSync(join(tmpdir(), 'weaver-capped-end-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('capped turns bypass repairs and checks even for changed content; the notice is once and #check resumes checks', async () => {
  const repo = new Repository(dir, join(dir, '.git'), join(dir, '.git'))
  const session = new Session(repo, 'capped', 'claude')
  const store = new SessionStore(session.dir, session.agent)
  const project = declaration({ limits: { maxRefusals: 1 }, finish: { headings: ['Request'] } })
  const checks = stubChecks([PASSING])
  const repairs = vi.spyOn(checks, 'repairs').mockReturnValue(true)
  const repair = vi.spyOn(checks, 'repair')
  vi.spyOn(repo, 'head').mockReturnValue('head')
  vi.spyOn(repo, 'hashPaths').mockImplementation(() => new Map([['a.ts', 'changed']]))
  const diff = vi.spyOn(UnitDiff, 'of').mockReturnValue(
    new UnitDiff({
      repo,
      dir: session.dir,
      base: 'base',
      head: 'changed',
      files: [{ status: 'M', path: 'a.ts', oldPath: 'a.ts', added: [[1, 1]] }],
      excluded: [],
    }),
  )
  store.update((record) => ({
    ...record,
    unit: {
      ...UnitOfWork.fresh(1).withFailedRound().record,
      files: { 'a.ts': { base: 'base', last: 'earlier', foreign: false, touchedAt: '', since: '' } },
    },
  }))
  try {
    const waiting = await finishWith(session, checks, project, 'Waiting for the owner.')
    assert.match(waiting.systemMessage ?? '', /Earlier check failures are left to the owner; the agent may stop\./)
    assert.equal(eventsOf(session, 'check').length, 0, 'an unfinished turn writes no verdict')
    const first = await finishWith(session, checks, project)
    assert.equal(first.decision, undefined)
    assert.match(first.systemMessage ?? '', /After 1 refusal, checks are left to the owner/)
    assert.match(first.systemMessage ?? '', /Request #check or run weaver check/)
    const second = await finishWith(session, checks, project)
    assert.equal(second.decision, undefined)
    assert.doesNotMatch(second.systemMessage ?? '', /Request #check/)
    assert.equal(checks.calls.count, 0)
    assert.equal(repairs.mock.calls.length, 0)
    assert.equal(repair.mock.calls.length, 0)
    assert.deepEqual(
      eventsOf(session, 'check').map(({ passed, afterCap }) => ({ passed, afterCap })),
      [
        { passed: false, afterCap: true },
        { passed: false, afterCap: true },
      ],
    )
    const report = readFileSync(/Report: (\S+)/.exec(second.systemMessage ?? '')?.[1] ?? '', 'utf8')
    assert.match(report, /Checks not re-run after 1 refusal; left to the owner: lint/)
    repairs.mockReturnValue(false)
    store.update((record) => ({
      ...record,
      unit: new UnitOfWork(record.unit).withRequest({
        text: '#check',
        at: new Date().toISOString(),
        source: 'prompt',
        answering: null,
      }).record,
    }))
    await finishWith(session, checks, project)
    assert.equal(checks.calls.count, 1)
    assert.equal(session.unit().number, 2)
  } finally {
    diff.mockRestore()
  }
})
