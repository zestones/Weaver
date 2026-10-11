import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DeclarationFolder } from '@weaver/engine'
import { afterAll, beforeEach, test } from 'vitest'
import { EngineLink } from '../../src/link/engine-link.ts'
import { LIMITS, makeProject, readJson, REVIEW, SETTINGS, weaver, writeConfig, writeJson } from '../fixtures/project.ts'

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
const CONFIG = '.weaver/settings.json'
const SKILL = '.weaver/skills/wv-finish.md'
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

test('install wires each runtime to the events it fires and the tools Weaver reads, and starts a valid configuration', async () => {
  const { status, lines } = await weaver(top, ['install'])
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

  for (const part of ['settings', 'guards', 'checks', 'scripts', 'labels'] as const) {
    const file = part === 'settings' ? CONFIG : `.weaver/project/${part}.json`

    assert.equal(readJson<{ $schema: string }>(top, file).$schema, link.schemaOf(part), 'each file names the schema it follows')
  }

  assert.deepEqual(readJson<{ finish: unknown }>(top, CONFIG).finish, { skill: SKILL })
  assert.deepEqual(
    readJson<{ checks: unknown }>(top, CONFIG).checks,
    LIMITS,
    'every limit Weaver applies is written in the settings, where the owner changes it',
  )
  assert.equal(existsSync(join(top, '.weaver/llm')), false, 'who reviews and who writes the cards are the owner’s to add')
  assert.deepEqual(readJson(top, '.weaver/project/labels.json'), { $schema: link.schemaOf('labels') })
  assert.deepEqual(DeclarationFolder.in(top).load()?.labels, {})
  assert.equal(existsSync(join(top, '.weaver/skills/wv-card.md')), false, 'a project that names no writer gets no skill for one')
  assert.deepEqual(DeclarationFolder.in(top).load()?.rules, [])
  assert.deepEqual(DeclarationFolder.in(top).load()?.finish.headings, ['Request', 'To validate', 'Found along the way'])
  assert.ok(lines.includes('.weaver/ created: declare your guards and your checks in .weaver/project/.'))
  assert.match(
    readFileSync(join(top, SKILL), 'utf8'),
    /## Request\n\nWhat you did for the request[^]*## To validate\n\n[^]*## Found along the way\n\nWhat you noticed outside the request\. Flag each thing with `weaver flag` when you find it, and name it here with the number of its flag\. Do not do it in the task, unless the task cannot go on without it: flag it then as fixed in the task\.\n```\n/,
  )
  assert.ok(lines.includes(`${SKILL} created: it tells the agent how to end a task. Adapt it to your project.`))
  assert.ok(lines.some((line) => line.includes(`${CLAUDE} is not ignored by git`)))
  assert.ok(lines.some((line) => line.includes('This is temporary')))
})

test('the command install writes is one the runtime can run as it is', async () => {
  await weaver(top, ['install'])

  const command = readJson<Settings>(top, CLAUDE).hooks.Stop?.[0]?.hooks[0]?.command ?? ''
  const result = spawnSync('sh', ['-c', command], { cwd: top, input: JSON.stringify({ session_id: 's', cwd: top }), encoding: 'utf8' })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '{}')
})

test('install twice wires once, and leaves what the owner put in the files', async () => {
  const mine = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine', timeout: 5 }] }
  const declared = JSON.stringify({ version: 1, checks: { ...LIMITS, maxRefusals: 5 } })

  writeJson(top, CLAUDE, { permissions: { deny: ['Read(.env)'] }, hooks: { PreToolUse: [mine], Notification: [mine] } })
  writeJson(top, CONFIG, JSON.parse(declared))
  await weaver(top, ['install'])

  const { lines } = await weaver(top, ['install'])
  const claude = readJson<Settings>(top, CLAUDE)

  assert.deepEqual(claude.permissions, { deny: ['Read(.env)'] })
  assert.deepEqual(claude.hooks.Notification, [mine])
  assert.deepEqual(claude.hooks.PreToolUse?.[0], mine)
  for (const event of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop']) {
    assert.equal(weaverGroups(claude, event).length, 1, event)
  }

  assert.deepEqual(JSON.parse(readFileSync(join(top, CONFIG), 'utf8')), JSON.parse(declared))
  assert.ok(lines.includes('.weaver/ kept as it is.'))
  assert.equal(existsSync(join(top, '.weaver/project')), false, 'nothing is added to a declaration the owner wrote')
  assert.equal(existsSync(join(top, SKILL)), false, 'a project that names no skill gets none')
})

test('a skill the settings name is written once, with the headings a task ends by in its header, and never written over', async () => {
  writeJson(top, CONFIG, { ...SETTINGS, finish: { skill: 'docs/fin.md' } })
  await weaver(top, ['install', 'claude'])

  const written = readFileSync(join(top, 'docs/fin.md'), 'utf8')

  assert.match(written, /^---\ndescription: [^\n]*\nheadings:\n {2}- Request\n {2}- To validate\n {2}- Found along the way\n---\n/)
  assert.deepEqual(DeclarationFolder.in(top).load()?.finish.headings, ['Request', 'To validate', 'Found along the way'])
  writeJson(top, 'docs/fin.md', 'mine now')
  assert.ok(!(await weaver(top, ['install', 'claude'])).lines.some((line) => line.includes('docs/fin.md created')))
  assert.equal(readJson<string>(top, 'docs/fin.md'), 'mine now')
})

test('the skill of the reviewer is written the same way, where the configuration says', async () => {
  writeConfig(top, { settings: SETTINGS, reviewers: { ...REVIEW, runtime: 'codex', skill: 'docs/review.md' } })

  const { lines } = await weaver(top, ['install', 'claude'])

  assert.ok(
    lines.includes('docs/review.md created: it tells the reviewer how this project wants its changes reviewed. Adapt it to your project.'),
  )
  assert.match(
    readFileSync(join(top, 'docs/review.md'), 'utf8'),
    /## What counts as a finding\n\n- A finding is a place where the change breaks one of the rules/,
  )
  assert.ok(!(await weaver(top, ['install', 'claude'])).lines.some((line) => line.includes('docs/review.md created')))
})

test('the skill of the writer is written when the configuration names it, with the sections of a card in its header, and never written over', async () => {
  const mine = '---\nsections:\n  - What\n  - Why\n---\n\nWrite short cards.\n'

  writeConfig(top, { settings: SETTINGS, writer: { runtime: 'codex', timeoutSeconds: 600, skill: 'docs/card.md' } })

  const { lines } = await weaver(top, ['install', 'claude'])
  const written = readFileSync(join(top, 'docs/card.md'), 'utf8')

  assert.ok(lines.includes('docs/card.md created: it tells the writer how this project wants its cards written. Adapt it to your project.'))
  assert.match(written, /^---\ndescription: [^\n]*\nsections:\n {2}- Observation\n {2}- Context\n {2}- Trace\n {2}- Uncertainties\n---\n/)
  assert.deepEqual(DeclarationFolder.in(top).load()?.writer?.sections, ['Observation', 'Context', 'Trace', 'Uncertainties'])
  assert.match(written, /understood alone, months later/)
  assert.match(written, /neither an investigation nor a certainty/)
  assert.match(written, /Keep what was seen apart from what is concluded/)
  assert.match(
    written,
    /- \*\*Observation\*\*: What was seen, and where[^\n]*\n- \*\*Context\*\*: [^\n]*\n- \*\*Trace\*\*: [^\n]*\n- \*\*Uncertainties\*\*: /,
  )
  assert.match(written, /GitHub callout[^\n]*mermaid diagram/)
  assert.match(written, /\n- No emoji\.\n/)

  writeFileSync(join(top, 'docs/card.md'), mine)
  assert.ok(!(await weaver(top, ['install', 'claude'])).lines.some((line) => line.includes('docs/card.md created')))
  assert.equal(readFileSync(join(top, 'docs/card.md'), 'utf8'), mine)
  assert.deepEqual(DeclarationFolder.in(top).load()?.writer?.sections, ['What', 'Why'])
})

test('install may name the runtimes to wire, and refuses a name it does not know', async () => {
  assert.equal((await weaver(top, ['install', 'codex'])).status, 0)
  assert.equal(existsSync(join(top, CODEX)), true)
  assert.equal(existsSync(join(top, CLAUDE)), false)

  const unknown = await weaver(top, ['install', 'vim'])

  assert.equal(unknown.status, 1)
  assert.deepEqual(unknown.lines, ['weaver: unknown agent runtime vim: Weaver reads claude, codex'])
})

test('nothing is written when the hook cannot start, or outside a git repository', async () => {
  const dead = await weaver(top, ['install'], { link: new EngineLink(join(scratch, 'nowhere/hook.js'), link.schemas) })
  const outside = await weaver(scratch, ['install'])

  assert.equal(dead.status, 1)
  assert.match(dead.lines[0] ?? '', /^The hook does not start/)
  assert.equal(existsSync(join(top, CLAUDE)), false)
  assert.equal(existsSync(join(top, CONFIG)), false)
  assert.equal(outside.status, 1)
  assert.match(outside.lines[0] ?? '', /is not inside a git repository$/)
})

test('a file that is not JSON is left alone and named', async () => {
  writeJson(top, CLAUDE, {})
  spawnSync('sh', ['-c', `printf '{ not json' > ${CLAUDE}`], { cwd: top })

  assert.deepEqual((await weaver(top, ['install', 'claude'])).lines, [
    `weaver: ${CLAUDE} is not valid JSON: fix it or remove it, then run the command again`,
  ])
})

test('without a command, or with one it does not know, weaver lists what it can do', async () => {
  const usage = await weaver(top, [])

  assert.equal(usage.status, 0)
  assert.equal(usage.lines[0], 'weaver <command>')
  assert.deepEqual(
    usage.lines.slice(2).map((line) => line.trim().split(/ {2,}/)[0]),
    [
      'install [claude] [codex]',
      'uninstall [claude] [codex]',
      'doctor',
      'version',
      'flag <place>...',
      'cards [<number>] [--all] [--file <path>] [--label <family:value>]',
      'cards reopen <number> [note]',
      'cards retitle <number> <title>',
      'cards label <number> <family:value>...',
      'cards rewrite <number>',
      'cards tie <a> <b> [note]',
      'cards untie <a> <b>',
      'cards separate <number>',
      'close <number> fixed|wontfix|issue [reason]',
    ],
  )
  assert.deepEqual(await weaver(top, ['help']), usage)
  assert.deepEqual((await weaver(top, ['status'])).status, 2, 'status went away with the ledger')
  assert.equal((await weaver(top, ['frobnicate'])).status, 2)
})
