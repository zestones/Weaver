import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { CodexExecution } from '../../src/adapters/codex/codex-execution.ts'
import { CodexHooks } from '../../src/adapters/codex/codex-hooks.ts'
import { fakeAppServer } from '../fixtures/fake-app-server.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-sdk-codex-hooks-'))
// Codex greets back, says a word of its own, then lists the hooks once it was told the greeting is over.
const GREETING = `if (message.method === 'initialize') { say({ id: message.id, result: {} }); say({ method: 'configWarning', params: {} }) }`
const server = (name: string, listing: string): string =>
  fakeAppServer(scratch, name, `${GREETING}\nif (message.method === 'hooks/list' && heard.includes('initialized')) { ${listing} }`)

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

test('the hooks Codex holds for a folder are asked to its app server, each with whether it runs', async () => {
  const codex = server(
    'codex',
    `say({ id: message.id, result: { data: [{ cwd: message.params.cwds[0], warnings: [], errors: [], hooks: [
  { handlerType: 'command', command: 'hook Stop', enabled: true, trustStatus: 'trusted' },
  { handlerType: 'command', command: 'hook PreToolUse', enabled: true, trustStatus: 'untrusted' },
  { handlerType: 'command', command: 'hook PostToolUse', enabled: true, trustStatus: 'modified' },
  { handlerType: 'command', command: 'policy', enabled: true, trustStatus: 'managed' },
  { handlerType: 'command', command: 'hook UserPromptSubmit', enabled: false, trustStatus: 'trusted' },
  { handlerType: 'prompt', enabled: true, trustStatus: 'trusted' },
  { handlerType: 'command', command: JSON.stringify({ argv, cwd: process.cwd(), asked: message.params.cwds, pid: process.pid }), enabled: true, trustStatus: 'trusted' },
] }] } })`,
  )
  const answer = await new CodexExecution(codex).hooks(scratch)
  const seen = JSON.parse(answer.hooks.at(-1)?.command ?? '{}') as { argv: string[]; cwd: string; asked: string[]; pid: number }

  assert.equal(answer.failure, null)
  assert.deepEqual(answer.hooks.slice(0, -1), [
    { command: 'hook Stop', standing: 'runs' },
    { command: 'hook PreToolUse', standing: 'waits' },
    { command: 'hook PostToolUse', standing: 'waits' },
    { command: 'policy', standing: 'runs' },
    { command: 'hook UserPromptSubmit', standing: 'off' },
  ])
  assert.deepEqual([seen.argv, seen.cwd, seen.asked], [['app-server'], scratch, [scratch]])

  await assert.doesNotReject(
    (async () => {
      for (let waited = 0; isRunning(seen.pid) && waited < 3000; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20))
    })(),
  )
  assert.equal(isRunning(seen.pid), false, 'the app server is stopped once it has answered')
})

test('a Codex that refuses, that answers something else, that ends, that stays silent or that does not start says why no hook is known', async () => {
  const refusing = server('refusing', `say({ id: message.id, error: { code: -32600, message: 'hooks are turned off' } })`)
  const vague = server('vague', `say({ id: message.id, result: { data: [] } })`)
  const ending = server('ending', `process.exit(0)`)
  const silent = server('silent', ``)
  const failure = async (binary: string): Promise<unknown> => (await new CodexHooks(binary, 400).of(scratch)).failure

  assert.deepEqual(await new CodexHooks(refusing).of(scratch), { hooks: [], failure: 'hooks are turned off' })
  assert.equal(await failure(vague), 'its answer has no list of hooks')
  assert.equal(await failure(ending), 'its app server gave no answer')
  assert.equal(await failure(silent), 'its app server gave no answer')
  assert.equal(await failure('/nowhere/codex'), 'its app server gave no answer')
})
