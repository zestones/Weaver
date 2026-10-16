import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import { makeProject, SETTINGS, weaver, writeConfig } from '../fixtures/project.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-guide-'))
let top: string
let counter = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  top = makeProject(join(scratch, `project-${String(counter)}`))
})

test('the guide an agent prints is the one its runtime reads as a skill, with what the project declares', async () => {
  await weaver(top, ['install', 'claude'])

  const { status, lines } = await weaver(top, ['guide'], { under: 'claude' })
  const skill = readFileSync(join(top, '.claude/skills/weaver/SKILL.md'), 'utf8')

  assert.equal(status, 0)
  assert.equal(lines[0], '# Working under Weaver')
  assert.ok(skill.endsWith(`\n${lines.join('\n')}\n`), 'the skill holds the same guide, under its header')
})

test('every command the guide names is one weaver has', async () => {
  writeConfig(top, { settings: SETTINGS })

  const guide = (await weaver(top, ['guide'])).lines.join('\n')
  const named = new Set(
    [...guide.matchAll(/`weaver ([a-z]+(?: (?:reopen|retitle|label|rewrite|tie|untie|separate))?)/g)].map(([, name]) => name ?? ''),
  )

  assert.ok(named.size >= 10, [...named].join(', '))

  for (const name of named) assert.equal((await weaver(top, ['help', ...name.split(' ')])).status, 0, `weaver ${name}`)
})

test('a project that declares nothing has no guide to give', async () => {
  const { status, lines } = await weaver(top, ['guide'])

  assert.equal(status, 1)
  assert.match(lines[0] ?? '', /No guide: this project declares nothing for Weaver\./)
})
