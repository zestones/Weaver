import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { ClaudeCodeExecution } from '../../src/adapters/claude/claude-code-execution.ts'
import { AgentTask } from '../../src/ports/agent-task.ts'
import { fakeBinary } from '../fixtures/fake-binary.ts'

interface Seen {
  readonly argv: string[]
  readonly cwd: string
  readonly marked: string | null
  readonly settings: unknown
}

const scratch = mkdtempSync(join(tmpdir(), 'weaver-sdk-claude-'))
const claude = new ClaudeCodeExecution(
  fakeBinary(
    scratch,
    'claude',
    `const settingsAt = argv.indexOf('--settings')
const settings = settingsAt === -1 ? null : JSON.parse(require('node:fs').readFileSync(argv[settingsAt + 1], 'utf8'))
if (asked === 'ask:garbage') { console.log('not json'); process.exit(3) }
if (asked === 'ask:slow') setTimeout(() => {}, 30000)
else if (asked === 'ask:refused') console.log(JSON.stringify({ result: 'Credit balance is too low', is_error: true }))
else if (asked === 'ask:shaped') console.log(JSON.stringify({ result: 'Here it is.', structured_output: { name: 'one' }, is_error: false }))
else if (asked === 'ask:shaped-as-text') console.log(JSON.stringify({ result: '{"name":"two"}', is_error: false }))
else if (asked === 'ask:unshaped') console.log(JSON.stringify({ result: 'I could not say.', is_error: false }))
else console.log(JSON.stringify({ result: JSON.stringify({ argv, settings, cwd: process.cwd(), marked: process.env.WEAVER_TEST_MARK ?? null }), is_error: false, total_cost_usd: 0.012 }))`,
  ),
)
const ALONE = ['-p', '--output-format', 'json', '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config']

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

const task = (prompt: string, fields: Partial<ConstructorParameters<typeof AgentTask>[0]> = {}): AgentTask =>
  new AgentTask({ prompt, cwd: scratch, access: 'read-only', timeoutSeconds: 20, ...fields })
const seenBy = async (asked: AgentTask): Promise<Seen> => JSON.parse((await claude.run(asked)).text) as Seen

test('a read-only task is asked without a terminal and without anyone’s settings, with only the tools that read, where the task says', async () => {
  const result = await claude.run(task('ask:echo'))
  const seen = JSON.parse(result.text) as Seen

  assert.equal(result.succeeded, true)
  assert.equal(result.costUsd, 0.012)
  assert.deepEqual(seen.argv, [...ALONE, '--allowedTools', 'Read', 'Grep', 'Glob'])
  assert.equal(seen.cwd, scratch)
})

test('a prompt longer than an argument may be is read all the same', async () => {
  const long = `ask:echo${' x'.repeat(200_000)}`

  assert.equal((await claude.run(task(long))).succeeded, true)
})

test('a task may add variables to the environment its agent runs in', async () => {
  assert.equal((await seenBy(task('ask:echo', { environment: { WEAVER_TEST_MARK: 'yes' } }))).marked, 'yes')
  assert.equal((await seenBy(task('ask:echo'))).marked, null)
})

test('a task that writes runs commands too, and names its model and its effort when it has them', async () => {
  const seen = await seenBy(task('ask:echo', { access: 'write', model: 'claude-haiku-5-5', effort: 'low' }))

  assert.deepEqual(seen.argv.slice(ALONE.length), [
    '--model',
    'claude-haiku-5-5',
    '--effort',
    'low',
    '--permission-mode',
    'bypassPermissions',
  ])
})

test('a task that writes is held by the command it names, started before each tool call for as long as the task lasts', async () => {
  const beforeTool = ['node', '/weaver/hook.js', 'PreToolUse', '--review-copy=/copy']
  const seen = await seenBy(task('ask:echo', { access: 'write', beforeTool }))
  const settings = seen.argv[seen.argv.indexOf('--settings') + 1] ?? ''

  assert.deepEqual(seen.settings, {
    hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'node', args: beforeTool.slice(1), timeout: 10 }] }] },
  })
  assert.equal(existsSync(settings), false)
  assert.equal((await seenBy(task('ask:echo', { beforeTool }))).settings, null, 'a task that only reads needs no one to hold it')
})

test('a task that asks for a shape gets its answer read: given by the runtime, or found in the last message', async () => {
  const answerSchema = { type: 'object', required: ['name'], properties: { name: { type: 'string' } } }
  const echoed = await seenBy(task('ask:echo', { answerSchema }))
  const shaped = await claude.run(task('ask:shaped', { answerSchema }))
  const asText = await claude.run(task('ask:shaped-as-text', { answerSchema }))
  const unshaped = await claude.run(task('ask:unshaped', { answerSchema }))

  assert.deepEqual(echoed.argv.slice(ALONE.length, ALONE.length + 2), ['--json-schema', JSON.stringify(answerSchema)])
  assert.deepEqual([shaped.answer, shaped.text, shaped.failure], [{ name: 'one' }, 'Here it is.', null])
  assert.deepEqual(asText.answer, { name: 'two' })
  assert.deepEqual([unshaped.failure, unshaped.failureKind], ['the agent did not give its answer in the shape it was asked for', 'answer'])
  assert.equal((await claude.run(task('ask:shaped'))).answer, null, 'a task that asked for no shape has no answer to read')
})

test('a task that fails is an answer that says why: refused by the runtime, unreadable, too slow, or no runtime at all', async () => {
  const refused = await claude.run(task('ask:refused'))
  const garbage = await claude.run(task('ask:garbage'))
  const slow = await claude.run(task('ask:slow', { timeoutSeconds: 1 }))
  const absent = await new ClaudeCodeExecution(join(scratch, 'nowhere')).run(task('ask:echo'))

  assert.deepEqual([refused.succeeded, refused.failure, refused.failureKind], [false, 'Credit balance is too low', 'runtime'])
  assert.match(garbage.failure ?? '', /^claude exited with 3: not json/)
  assert.deepEqual([slow.failure, slow.failureKind], ['no answer after 1 s', 'timeout'])
  assert.match(absent.failure ?? '', /ENOENT/)
  assert.equal((await claude.run(task('ask:echo'))).failureKind, null)
})

test('a runtime is available when its command line starts', () => {
  assert.equal(claude.isAvailable(), true)
  assert.equal(new ClaudeCodeExecution(join(scratch, 'nowhere')).isAvailable(), false)
})

test('Claude Code has no way to say which hooks it runs in a folder', async () => {
  assert.equal(await claude.hooks(), null)
})
