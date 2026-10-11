import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { CodexExecution } from '../../src/adapters/codex/codex-execution.ts'
import { AgentTask } from '../../src/ports/agent-task.ts'
import { fakeBinary } from '../fixtures/fake-binary.ts'

interface Seen {
  readonly argv: string[]
  readonly cwd: string
  readonly schema: unknown
}

const scratch = mkdtempSync(join(tmpdir(), 'weaver-sdk-codex-'))
const codex = new CodexExecution(
  fakeBinary(
    scratch,
    'codex',
    `const say = (event) => console.log(JSON.stringify(event))
const message = (text) => say({ type: 'item.completed', item: { type: 'agent_message', text } })
console.log('Reading additional input from stdin...')
say({ type: 'thread.started' })
if (asked === 'ask:failed') { say({ type: 'turn.failed', error: { message: 'usage limit reached' } }); process.exit(1) }
if (asked === 'ask:silent') say({ type: 'item.completed', item: { type: 'command_execution', text: 'ls' } })
else if (asked === 'ask:unshaped') message('I could not say.')
else {
  const schemaAt = argv.indexOf('--output-schema')
  const schema = schemaAt === -1 ? null : JSON.parse(require('node:fs').readFileSync(argv[schemaAt + 1], 'utf8'))
  message('Looking at the files.'); message(JSON.stringify({ argv, cwd: process.cwd(), schema }))
}
say({ type: 'turn.completed', usage: { input_tokens: 10 } })`,
  ),
)
const ALONE = ['exec', '--json', '--ephemeral', '--ignore-user-config']

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

const task = (prompt: string, fields: Partial<ConstructorParameters<typeof AgentTask>[0]> = {}): AgentTask =>
  new AgentTask({ prompt, cwd: scratch, access: 'read-only', timeoutSeconds: 20, ...fields })

test('a task is run without the owner’s configuration, in a sandbox that matches its access, and its answer is the last message', async () => {
  const reading = await codex.run(task('ask:echo'))
  const writing = await codex.run(task('ask:echo', { access: 'write', model: 'gpt-5.5', effort: 'low', beforeTool: ['node', 'hook.js'] }))
  const seen = JSON.parse(reading.text) as Seen

  assert.equal(reading.succeeded, true)
  assert.deepEqual(seen.argv, [...ALONE, '-s', 'read-only', '-'])
  assert.equal(seen.cwd, scratch)
  assert.deepEqual((JSON.parse(writing.text) as Seen).argv, [
    ...ALONE,
    ...['-s', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true', '-c', 'approval_policy="never"'],
    ...['-m', 'gpt-5.5', '-c', 'model_reasoning_effort="low"', '-'],
  ])
  assert.equal(reading.costUsd, null, 'Codex does not say what a task cost')
})

test('a turn the runtime reports as failed, and a run that ends without a message, are failures', async () => {
  const failed = await codex.run(task('ask:failed'))
  const silent = await codex.run(task('ask:silent'))

  assert.deepEqual([failed.succeeded, failed.failure, failed.failureKind], [false, 'usage limit reached', 'runtime'])
  assert.deepEqual([silent.text, silent.failure], ['', 'codex gave no message'])
})

test('a task that asks for a shape hands it to the runtime in a file that lasts as long as the task, and gets its answer read', async () => {
  const answerSchema = { type: 'object', required: ['argv'], properties: { argv: { type: 'array' } } }
  const shaped = await codex.run(task('ask:echo', { answerSchema }))
  const answer = shaped.answer as Seen
  const schemaFile = answer.argv[answer.argv.indexOf('--output-schema') + 1] ?? ''

  assert.equal(shaped.failure, null)
  assert.deepEqual(answer.schema, answerSchema)
  assert.equal(existsSync(schemaFile), false)
  assert.equal(
    (await codex.run(task('ask:unshaped', { answerSchema }))).failure,
    'the agent did not give its answer in the shape it was asked for',
  )
  assert.equal((await codex.run(task('ask:echo'))).answer, null)
})
