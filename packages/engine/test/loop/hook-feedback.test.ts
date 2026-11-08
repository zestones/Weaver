import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test, vi } from 'vitest'
import { Repository } from '../../src/lib/git/repository.ts'
import { Loop } from '../../src/loop/dispatch/loop.ts'
import { Answer } from '../../src/loop/exchange/answer.ts'
import { HookFeedback } from '../../src/loop/exchange/hook-feedback.ts'
import { Journal } from '../../src/unit-of-work/journal/journal.ts'
import { declarationFiles, writeDeclaration } from '../fixtures/declaration.ts'
import { makeRepo, writeFiles } from '../fixtures/repo.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-feedback-'))
let sequence = 0

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

for (const runtime of ['claude', 'codex']) {
  for (const event of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop']) {
    if (runtime === 'codex' && event === 'PostToolUseFailure') continue

    test(`${runtime} ${event} delivers a declaration failure once per session per ten minutes`, async () => {
      const repo = makeRepo(join(scratch, `repo-${String(sequence++)}`), declarationFiles({}))
      const loop = new Loop()
      const run = (session = 'owner') =>
        loop.handle(event, [`--agent=${runtime}`], JSON.stringify({ cwd: repo.top, session_id: session, prompt: 'work' }))

      writeFiles(repo.top, { '.weaver/project/checks.json': '{invalid' })
      const first = await run()
      const body = first.body
      const message = event === 'Stop' ? body?.systemMessage : body?.hookSpecificOutput?.additionalContext

      assert.match(message ?? '', /failed.*weaver doctor.*Journal:/)
      assert.equal(body?.decision, undefined, 'a failure does not restart Stop')
      assert.equal((await run()).body, null)
      assert.notEqual((await run('another')).body, null)
      assert.equal(new Journal(repo).readSession('owner').filter((entry) => entry.kind === 'error').length, 2)
    })
  }

  test(`${runtime} delivers a Stop failure to the next prompt or tool result exactly once`, async () => {
    for (const next of ['UserPromptSubmit', 'PostToolUse']) {
      const repo = makeRepo(join(scratch, `repo-${String(sequence++)}`), declarationFiles({}))
      const loop = new Loop()
      const run = (event: string) =>
        loop.handle(event, [`--agent=${runtime}`], JSON.stringify({ cwd: repo.top, session_id: 'owner', prompt: 'work' }))

      writeFiles(repo.top, { '.weaver/project/checks.json': '{invalid' })
      await run('Stop')
      writeDeclaration(repo.top, {})
      const first = await run(next)

      assert.match(first.body?.hookSpecificOutput?.additionalContext ?? '', /The end of the task failed/)
      assert.doesNotMatch((await run(next)).body?.hookSpecificOutput?.additionalContext ?? '', /The end of the task failed/)
    }
  })
}

test('bounded feedback preserves a tool denial and survives a broken journal', () => {
  const repo = new Repository(scratch, join(scratch, '.git'), join(scratch, '.git'))
  const journal = new Journal(repo)
  const feedback = new HookFeedback(journal, { session: 'owner', agent: 'claude' })

  vi.spyOn(journal, 'append').mockImplementation(() => {
    throw new Error('disk full')
  })
  vi.spyOn(journal, 'readSession').mockImplementation(() => {
    throw new Error('unreadable')
  })
  const answer = feedback.failure('PreToolUse', 'failure\n'.repeat(1000), Answer.refusing('guard says no'))
  const body = answer.body?.hookSpecificOutput

  assert.ok(body !== undefined && 'permissionDecision' in body)
  assert.equal(body.permissionDecision, 'deny')
  assert.equal(body.permissionDecisionReason, 'guard says no')
  assert.ok((body.additionalContext?.length ?? 0) < 1000)
})

test('a repeat is allowed after ten minutes, and broken session state reaches the agent', async () => {
  const repo = makeRepo(join(scratch, 'broken-state'), declarationFiles({}))
  const journal = new Journal(repo)
  const source = { session: 'owner', agent: 'claude' }

  journal.append(
    source,
    { kind: 'notification', event: 'PreToolUse', message: 'broken', channel: 'agent' },
    new Date(Date.now() - 11 * 60 * 1000).toISOString(),
  )
  assert.match(
    new HookFeedback(journal, source).failure('PreToolUse', 'broken').body?.hookSpecificOutput?.additionalContext ?? '',
    /broken/,
  )
  writeFiles(repo.top, { '.git/weaver/sessions/owner/state.json': '{invalid' })
  const answer = await new Loop().handle(
    'UserPromptSubmit',
    ['--agent=claude'],
    JSON.stringify({ cwd: repo.top, session_id: 'owner', prompt: 'work' }),
  )

  assert.match(answer.body?.hookSpecificOutput?.additionalContext ?? '', /hook failed/)
  assert.equal(journal.readSession('owner').filter((entry) => entry.kind === 'error').length, 2)
})
