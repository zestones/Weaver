import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DeclarationFile } from '@weaver/engine'
import { afterAll, beforeEach, test } from 'vitest'
import { EngineLink } from '../../src/link/engine-link.ts'
import { makeProject, readJson, weaver, writeJson } from '../fixtures/project.ts'

interface Group {
  readonly matcher?: string
  readonly hooks: readonly { readonly command: string; readonly timeout: number }[]
}

interface Settings {
  readonly permissions?: unknown
  readonly hooks: Readonly<Record<string, readonly Group[]>>
}

const CLAUDE = '.claude/settings.local.json'
const CODEX = '.codex/hooks.json'
const CONFIG = 'weaver.config.json'
const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-install-'))
const link = new EngineLink()
let top: string
let counter = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  top = makeProject(join(scratch, `project-${String(counter)}`))
})

const weaverGroups = (settings: Settings, event: string): Group[] =>
  (settings.hooks[event] ?? []).filter((group) => group.hooks.some((hook) => link.owns(hook.command)))

test('install wires each runtime to the events it fires and the tools Weaver reads, and starts a valid configuration', () => {
  const { status, lines } = weaver(top, ['install'])
  const claude = readJson<Settings>(top, CLAUDE)
  const codex = readJson<Settings>(top, CODEX)

  assert.equal(status, 0, lines.join('\n'))
  assert.deepEqual(Object.keys(claude.hooks), ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop'])
  assert.deepEqual(Object.keys(codex.hooks), ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'])
  assert.equal(claude.hooks.PreToolUse?.[0]?.matcher, 'Bash|Monitor|PowerShell|Write|Edit|MultiEdit|NotebookEdit')
  assert.equal(codex.hooks.PostToolUse?.[0]?.matcher, 'Bash|Monitor|PowerShell|apply_patch')
  assert.equal(claude.hooks.UserPromptSubmit?.[0]?.matcher, undefined)
  assert.equal(claude.hooks.Stop?.[0]?.hooks[0]?.timeout, 3600)
  assert.match(claude.hooks.Stop?.[0]?.hooks[0]?.command ?? '', /hook\.js" Stop --agent=claude --weaver$/)
  assert.match(codex.hooks.PreToolUse?.[0]?.hooks[0]?.command ?? '', /hook\.js" PreToolUse --agent=codex --weaver$/)

  assert.equal(readJson<{ $schema: string }>(top, CONFIG).$schema, link.schema)
  assert.deepEqual(DeclarationFile.in(top).load()?.rules, [])
  assert.ok(lines.some((line) => line.includes(`${CLAUDE} is not ignored by git`)))
  assert.ok(lines.some((line) => line.includes('This is temporary')))
})

test('the command install writes is one the runtime can run as it is', () => {
  weaver(top, ['install'])

  const command = readJson<Settings>(top, CLAUDE).hooks.Stop?.[0]?.hooks[0]?.command ?? ''
  const result = spawnSync('sh', ['-c', command], { cwd: top, input: JSON.stringify({ session_id: 's', cwd: top }), encoding: 'utf8' })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '{}')
})

test('install twice wires once, and leaves what the owner put in the files', () => {
  const mine = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine', timeout: 5 }] }
  const declared = '{"version":1,"rules":{"A8":{"level":"human","statement":"Dependencies are the owner’s."}}}'

  writeJson(top, CLAUDE, { permissions: { deny: ['Read(.env)'] }, hooks: { PreToolUse: [mine], Notification: [mine] } })
  writeJson(top, CONFIG, JSON.parse(declared))
  weaver(top, ['install'])

  const { lines } = weaver(top, ['install'])
  const claude = readJson<Settings>(top, CLAUDE)

  assert.deepEqual(claude.permissions, { deny: ['Read(.env)'] })
  assert.deepEqual(claude.hooks.Notification, [mine])
  assert.deepEqual(claude.hooks.PreToolUse?.[0], mine)
  for (const event of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop']) {
    assert.equal(weaverGroups(claude, event).length, 1, event)
  }

  assert.deepEqual(JSON.parse(readFileSync(join(top, CONFIG), 'utf8')), JSON.parse(declared))
  assert.ok(lines.includes(`${CONFIG} kept as it is.`))
})

test('install may name the runtimes to wire, and refuses a name it does not know', () => {
  assert.equal(weaver(top, ['install', 'codex']).status, 0)
  assert.equal(existsSync(join(top, CODEX)), true)
  assert.equal(existsSync(join(top, CLAUDE)), false)

  const unknown = weaver(top, ['install', 'vim'])

  assert.equal(unknown.status, 1)
  assert.deepEqual(unknown.lines, ['weaver: unknown agent runtime vim: Weaver reads claude, codex'])
})

test('nothing is written when the hook cannot start, or outside a git repository', () => {
  const dead = weaver(top, ['install'], new EngineLink(join(scratch, 'nowhere/hook.js'), link.schema))
  const outside = weaver(scratch, ['install'])

  assert.equal(dead.status, 1)
  assert.match(dead.lines[0] ?? '', /^The hook does not start/)
  assert.equal(existsSync(join(top, CLAUDE)), false)
  assert.equal(existsSync(join(top, CONFIG)), false)
  assert.equal(outside.status, 1)
  assert.match(outside.lines[0] ?? '', /is not inside a git repository$/)
})

test('a file that is not JSON is left alone and named', () => {
  writeJson(top, CLAUDE, {})
  spawnSync('sh', ['-c', `printf '{ not json' > ${CLAUDE}`], { cwd: top })

  assert.deepEqual(weaver(top, ['install', 'claude']).lines, [
    `weaver: ${CLAUDE} is not valid JSON: fix it or remove it, then run the command again`,
  ])
})

test('without a command, or with one it does not know, weaver lists what it can do', () => {
  const usage = weaver(top, [])

  assert.equal(usage.status, 0)
  assert.equal(usage.lines[0], 'weaver <command>')
  assert.deepEqual(
    usage.lines.slice(2).map((line) => line.trim().split(' ')[0]),
    ['install', 'uninstall', 'doctor'],
  )
  assert.equal(weaver(top, ['frobnicate']).status, 2)
})
