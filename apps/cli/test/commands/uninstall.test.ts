import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import { makeProject, readJson, weaver, writeJson } from '../fixtures/project.ts'

const CLAUDE = '.claude/settings.local.json'
const CODEX = '.codex/hooks.json'
const CONFIG = '.weaver/settings.json'
const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-uninstall-'))
let top: string
let counter = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  top = makeProject(join(scratch, `project-${String(counter)}`))
})

test('uninstall removes the files it had created, and leaves the rules and the records', async () => {
  await weaver(top, ['install'])
  mkdirSync(join(top, '.git/weaver'), { recursive: true })
  mkdirSync(join(top, '.agents/skills/mine'), { recursive: true })
  writeFileSync(join(top, '.agents/skills/mine/SKILL.md'), '---\nname: mine\n---\n')

  const { status, lines } = await weaver(top, ['uninstall'])

  assert.equal(status, 0)
  assert.equal(existsSync(join(top, CLAUDE)), false)
  assert.equal(existsSync(join(top, CODEX)), false)
  assert.equal(existsSync(join(top, '.claude/skills/weaver')), false, 'the folder of the guide goes with it')
  assert.equal(existsSync(join(top, '.agents/skills/mine/SKILL.md')), true, 'a skill of the owner stays')
  assert.equal(existsSync(join(top, CONFIG)), true)
  assert.equal(existsSync(join(top, '.git/weaver')), true)
  assert.deepEqual(lines, [
    `✓ Claude Code: hooks removed from ${CLAUDE}`,
    '✓ Claude Code: the guide of Weaver removed from .claude/skills/weaver/SKILL.md',
    `✓ Codex: hooks removed from ${CODEX}`,
    '✓ Codex: the guide of Weaver removed from .agents/skills/weaver/SKILL.md',
    '',
    ".weaver/ and .git/weaver/ are left: they hold your rules and Weaver's records.",
  ])
})

test('uninstall takes only Weaver’s hooks out of a file the owner also uses', async () => {
  const mine = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine', timeout: 5 }] }

  writeJson(top, CLAUDE, { permissions: { deny: ['Read(.env)'] }, hooks: { PreToolUse: [mine] } })
  await weaver(top, ['install', 'claude'])
  await weaver(top, ['uninstall'])

  assert.deepEqual(readJson(top, CLAUDE), { permissions: { deny: ['Read(.env)'] }, hooks: { PreToolUse: [mine] } })
})

test('uninstall on a project that was never wired says so and changes nothing', async () => {
  writeJson(top, CLAUDE, { permissions: {} })

  assert.deepEqual((await weaver(top, ['uninstall'])).lines.slice(0, 2), ['- Claude Code: no hook to remove', '- Codex: no hook to remove'])
  assert.deepEqual(readJson(top, CLAUDE), { permissions: {} })
})
