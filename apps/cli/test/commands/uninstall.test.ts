import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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

test('uninstall removes the files it had created, and leaves the rules and the records', () => {
  weaver(top, ['install'])
  mkdirSync(join(top, '.git/weaver'), { recursive: true })

  const { status, lines } = weaver(top, ['uninstall'])

  assert.equal(status, 0)
  assert.equal(existsSync(join(top, CLAUDE)), false)
  assert.equal(existsSync(join(top, CODEX)), false)
  assert.equal(existsSync(join(top, CONFIG)), true)
  assert.equal(existsSync(join(top, '.git/weaver')), true)
  assert.deepEqual(lines, [
    `Claude Code: hooks removed from ${CLAUDE}`,
    `Codex: hooks removed from ${CODEX}`,
    ".weaver/ and .git/weaver/ are left: they hold your rules and Weaver's records.",
  ])
})

test('uninstall takes only Weaver’s hooks out of a file the owner also uses', () => {
  const mine = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine', timeout: 5 }] }

  writeJson(top, CLAUDE, { permissions: { deny: ['Read(.env)'] }, hooks: { PreToolUse: [mine] } })
  weaver(top, ['install', 'claude'])
  weaver(top, ['uninstall'])

  assert.deepEqual(readJson(top, CLAUDE), { permissions: { deny: ['Read(.env)'] }, hooks: { PreToolUse: [mine] } })
})

test('uninstall on a project that was never wired says so and changes nothing', () => {
  writeJson(top, CLAUDE, { permissions: {} })

  assert.deepEqual(weaver(top, ['uninstall']).lines.slice(0, 2), ['Claude Code: no hook to remove', 'Codex: no hook to remove'])
  assert.deepEqual(readJson(top, CLAUDE), { permissions: {} })
})
