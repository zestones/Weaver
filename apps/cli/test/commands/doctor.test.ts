import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import { EngineLink } from '../../src/link/engine-link.ts'
import { RuntimeCatalog } from '../../src/runtimes/runtime-catalog.ts'
import { makeProject, weaver } from '../fixtures/project.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-doctor-'))
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

test('a project that was never wired is told that agents work there unsupervised', () => {
  const { status, lines } = weaver(top, ['doctor'])

  assert.equal(status, 1)
  assert.deepEqual(lines, [
    'PROBLEM no weaver.config.json: Weaver does nothing in this project. Run weaver install.',
    `ok      the hook starts: ${link.hook}`,
    '-       Claude Code: not wired',
    '-       Codex: not wired',
    'PROBLEM no agent runtime is wired: agents work here unsupervised. Run weaver install.',
  ])
})

test('after install everything is alive; a runtime left out is only noted', () => {
  weaver(top, ['install', 'claude'])

  const { status, lines } = weaver(top, ['doctor'])

  assert.equal(status, 0, lines.join('\n'))
  assert.deepEqual(lines, [
    'ok      weaver.config.json: 0 rule(s), 0 check(s), 0 guard(s)',
    `ok      the hook starts: ${link.hook}`,
    'ok      Claude Code: wired in .claude/settings.local.json',
    '-       Codex: not wired',
    '-       an agent started outside these runtimes is not supervised',
  ])
})

test('hooks that point to a Weaver that is no longer there are a problem, and so is a hook that does not start', () => {
  const moved = new EngineLink(join(scratch, 'old-checkout/hook.js'), link.schema)

  for (const runtime of new RuntimeCatalog().settings(top, moved, ['codex'])) runtime.install()

  const stale = weaver(top, ['doctor'])
  const dead = weaver(top, ['doctor'], moved)

  assert.equal(stale.status, 1)
  assert.ok(stale.lines.includes('PROBLEM Codex: the hooks in .codex/hooks.json point somewhere else. Run weaver install.'))
  assert.equal(dead.status, 1)
  assert.ok(dead.lines.includes(`PROBLEM the hook does not start: ${moved.hook}. Build Weaver with pnpm build.`))
})

test('a configuration that cannot be read is a problem, with what is wrong in it', () => {
  weaver(top, ['install'])
  writeFileSync(join(top, 'weaver.config.json'), '{"version":1,"chekcs":{}}')

  const { status, lines } = weaver(top, ['doctor'])

  assert.equal(status, 1)
  assert.match(lines[0] ?? '', /^PROBLEM .*weaver\.config\.json is not a valid project declaration: chekcs is not a known field$/)
})
