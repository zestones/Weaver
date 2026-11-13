import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test, vi } from 'vitest'
import { DeclarationMigrations } from '../../src/declaration/migrating/running/declaration-migrations.ts'
import { DeclarationFolder } from '../../src/declaration/reading/declaration-folder.ts'
import { Repository } from '../../src/lib/git/repository.ts'
import { Loop } from '../../src/loop/dispatch/loop.ts'
import { Answer } from '../../src/loop/exchange/answer.ts'
import { HookFeedback } from '../../src/loop/exchange/hook-feedback.ts'
import { Journal } from '../../src/unit-of-work/journal/journal.ts'
import { declarationFiles } from '../fixtures/declaration.ts'
import { git, locate, makeRepo, writeFiles } from '../fixtures/repo.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-format-'))

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

for (const runtime of ['claude', 'codex']) {
  test(`${runtime} supervises a worktree with committed format 2 and tells both sides once per session`, async () => {
    const files = declarationFiles({
      writer: { enabled: false },
      guards: { history: { statement: 'The owner commits.', runs: ['git commit'] } },
    })
    files['.weaver/settings.json'] = JSON.stringify({
      version: 2,
      checks: { maxRefusals: 3, totalTimeoutSeconds: 1200, parallel: 3, warnTimeoutSeconds: 30 },
    })
    const main = makeRepo(join(scratch, `${runtime}-main`), files)
    const migrated = DeclarationFolder.in(main.top)
    migrated.write(new DeclarationMigrations(migrated.texts()).run().texts)
    const worktree = join(scratch, `${runtime}-worktree`)
    git(main.top, ['worktree', 'add', '--detach', worktree, 'HEAD'])
    const repo = locate(worktree)
    const folder = DeclarationFolder.in(repo.top)
    const before = folder.texts()
    const run = (event: string, session = 'session', agentId?: string) =>
      new Loop().handle(
        event,
        [`--agent=${runtime}`],
        JSON.stringify({
          cwd: repo.top,
          session_id: session,
          agent_id: agentId,
          prompt: 'work',
          tool_name: 'Bash',
          tool_input: { command: 'git commit -m test' },
          tool_use_id: 'call',
        }),
      )

    assert.doesNotMatch((await run('PreToolUse', 'session', 'child')).print(), /read as format/)
    const first = await run('PreToolUse')
    assert.match(first.body?.systemMessage ?? '', /format 2, read as format 4 in memory/)
    assert.match(first.body?.hookSpecificOutput?.additionalContext ?? '', /commit the migrated \.weaver\/.*worktrees and clones/)
    assert.equal(
      (first.body?.hookSpecificOutput as { permissionDecision?: string }).permissionDecision,
      'deny',
      'the project guard still supervises the call',
    )
    for (const event of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop']) {
      assert.doesNotMatch((await run(event)).print(), /read as format/)
    }
    assert.match((await run('UserPromptSubmit', 'another')).print(), /read as format/)
    assert.deepEqual(folder.texts(), before)
    assert.equal(new DeclarationMigrations(migrated.texts()).written, 4)
    const notices = new Journal(repo).readSession('session').filter((entry) => entry.kind === 'notification')
    assert.deepEqual(notices.map((entry) => entry.channel).sort(), ['agent', 'owner'])
  })
}

test('a format notice at Stop reaches the owner, then the agent, and survives error receipt expiry', () => {
  const top = join(scratch, 'receipts')
  const repo = new Repository(top, join(top, '.git'), join(top, '.git'))
  const source = { session: 'session', agent: 'claude' }
  const message = 'An older format is read in memory.'
  const notice = (event: string) => new HookFeedback(new Journal(repo), source).notice(event, message, Answer.silent())

  assert.equal(notice('Stop').body?.systemMessage, `[weaver] ${message}`)
  assert.equal(notice('Stop').body, null)
  assert.equal(notice('PostToolUse').body?.hookSpecificOutput?.additionalContext, `[weaver] ${message}`)
  const now = Date.now()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60 * 1000)
  try {
    new HookFeedback(new Journal(repo), source).failure('PreToolUse', 'an unrelated error')
    assert.equal(notice('UserPromptSubmit').body, null)
    assert.equal(new Journal(repo).untoldStopFailure(source.session), null)
  } finally {
    clock.mockRestore()
  }
})

test('an invalid older declaration still reports validation errors and is never rewritten', async () => {
  const repo = makeRepo(join(scratch, 'invalid'), declarationFiles({}))
  writeFiles(repo.top, { '.weaver/settings.json': '{"version":2,"checks":{}}' })
  const folder = DeclarationFolder.in(repo.top)
  const before = folder.texts()
  const answer = await new Loop().handle('PreToolUse', ['--agent=claude'], JSON.stringify({ cwd: repo.top, session_id: 'invalid' }))
  assert.match(answer.print(), /not a valid project declaration/)
  assert.doesNotMatch(answer.print(), /Supervision continues/)
  assert.deepEqual(folder.texts(), before)
})
