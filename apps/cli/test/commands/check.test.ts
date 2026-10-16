import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Journal, Loop, Repository, type EventOf } from '@weaver/engine'
import { afterAll, beforeEach, test } from 'vitest'
import { makeProject, SETTINGS, weaver, writeConfig } from '../fixtures/project.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-check-'))
const SESSION = '3f2a91c0-5b7e-4c1d-9a44-0d6f2e8b1c73'
const PARSE = "for (const file of process.argv.slice(1)) require('node:child_process').execFileSync(process.execPath, ['--check', file])"
const CHECK = { cwd: '.', reads: 'exit', timeoutSeconds: 60 }
const FINISHED = '## Request\n\nDone.\n'
let top: string
let counter = 0
let calls = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  top = makeProject(join(scratch, `project-${String(counter)}`))
  writeConfig(top, {
    settings: SETTINGS,
    checks: {
      syntax: { ...CHECK, judge: ['node', '-e', PARSE, '{files}'], when: ['src/**/*.js'], rules: { S1: 'Source files parse.' } },
      docs: { ...CHECK, judge: ['true'], after: 'syntax', rules: { D1: 'The documentation builds.' } },
      other: { ...CHECK, judge: ['true'], rules: { O1: 'Something else holds.' } },
    },
  })
  write('src/a.js', 'export const a = 1\n')
  git(['add', '-A'])
  git(['commit', '-qm', 'initial'])
})

function git(args: readonly string[]): void {
  execFileSync('git', ['-C', top, '-c', 'user.email=test@example.com', '-c', 'user.name=Test', ...args])
}

function write(path: string, content: string): void {
  mkdirSync(dirname(join(top, path)), { recursive: true })
  writeFileSync(join(top, path), content)
}

async function hook(event: string, payload: Record<string, unknown>): Promise<string> {
  const answer = await new Loop().handle(event, ['--agent=claude'], JSON.stringify({ session_id: SESSION, cwd: top, ...payload }))

  return answer.print()
}

async function agentWrites(path: string, content: string): Promise<void> {
  calls += 1

  const call = { tool_name: 'Write', tool_input: { file_path: join(top, path), content }, tool_use_id: `call-${String(calls)}` }

  await hook('PreToolUse', call)
  write(path, content)
  await hook('PostToolUse', call)
}

// The hook sees the command go by before it runs; the command then runs apart, as the runtime starts it.
async function agentChecks(names: readonly string[]): Promise<{ status: number; lines: readonly string[] }> {
  calls += 1
  await hook('PreToolUse', {
    tool_name: 'Bash',
    tool_input: { command: ['weaver check', ...names].join(' ') },
    tool_use_id: `call-${String(calls)}`,
  })

  return weaver(top, ['check', ...names], { under: 'claude' })
}

function askedEvents(): EventOf<'asked'>[] {
  const repo = Repository.locate(top)

  if (repo === null) throw new Error(`no repository at ${top}`)

  return new Journal(repo).read().filter((event): event is EventOf<'asked'> => event.kind === 'asked')
}

test('the owner checks what they changed against HEAD, from a terminal', async () => {
  write('src/b.js', 'export const b = ;\n')

  const failing = await weaver(top, ['check'])

  assert.equal(failing.status, 1)
  assert.equal(failing.lines[0], '1 changed file of your changes against HEAD')
  assert.match(failing.lines.join('\n'), /X syntax failed\n/)
  assert.match(failing.lines.join('\n'), /✓ other passed/)

  write('src/b.js', 'export const b = 2\n')

  assert.equal((await weaver(top, ['check', 'syntax'])).status, 0)
})

test('an agent checks its own unit of work without ending its task, and the end of its task gives the verdict again', async () => {
  await hook('UserPromptSubmit', { prompt: 'add b' })
  await agentWrites('src/b.js', 'export const b = ;\n')
  write('src/owner.js', 'export const mine = ;\n')

  const asked = await agentChecks(['docs'])

  assert.equal(asked.status, 1)
  assert.equal(asked.lines[0], '1 changed file of the unit of work 1 of this session')
  assert.match(asked.lines.join('\n'), /X syntax failed\n[\s\S]*✓ docs passed/, 'a check runs after the one it waits for')
  assert.doesNotMatch(asked.lines.join('\n'), /other/)
  assert.deepEqual(
    askedEvents().map(({ unit, passed, failed, files }) => ({ unit, passed, failed, files })),
    [{ unit: 1, passed: false, failed: ['syntax'], files: 1 }],
    'the owner’s own file is not the agent’s to check',
  )

  const refused = JSON.parse(await hook('Stop', { last_assistant_message: FINISHED })) as { decision?: string; reason?: string }

  assert.equal(refused.decision, 'block')
  assert.match(refused.reason ?? '', /Not run again, since nothing they read changed after their last run: syntax\./)
})

test('a check the hook saw go by is the agent’s, even when its processes do not tell the runtime that started it', async () => {
  await hook('UserPromptSubmit', { prompt: 'add b' })
  await agentWrites('src/b.js', 'export const b = 2\n')
  write('src/owner.js', 'export const mine = ;\n')
  calls += 1
  await hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'weaver check syntax' }, tool_use_id: `call-${String(calls)}` })

  const asked = await weaver(top, ['check', 'syntax'])

  assert.equal(asked.status, 0)
  assert.equal(asked.lines[0], '1 changed file of the unit of work 1 of this session')
  assert.deepEqual(
    askedEvents().map(({ unit, files }) => ({ unit, files })),
    [{ unit: 1, files: 1 }],
  )
})

test('a check the hook did not see go by checks nothing, and a name the project does not declare is said', async () => {
  const unseen = await weaver(top, ['check'], { under: 'claude' })

  assert.equal(unseen.status, 1)
  assert.match(unseen.lines[0] ?? '', /Nothing was checked: Weaver's hook did not see this command go by/)

  const unknown = await weaver(top, ['check', 'lint'])

  assert.equal(unknown.status, 1)
  assert.match(unknown.lines[0] ?? '', /The project declares no check named lint: its checks are syntax, docs, other/)
})
