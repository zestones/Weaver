import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import { EngineLink } from '../../src/link/engine-link.ts'
import { RuntimeCatalog } from '../../src/runtimes/runtime-catalog.ts'
import { makeProject, weaver, writeJson } from '../fixtures/project.ts'

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
    'ok      the finish skill: .agents/skills/wv-finish.md',
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

test('a finish skill that is missing, or that no longer shows a heading the configuration waits for, is a problem', () => {
  weaver(top, ['install', 'claude'])
  writeFileSync(join(top, '.agents/skills/wv-finish.md'), '## Request\n\n## To validate\n')

  assert.ok(
    weaver(top, ['doctor']).lines.includes(
      'PROBLEM .agents/skills/wv-finish.md does not show ## Found along the way, which the configuration waits for.',
    ),
  )

  rmSync(join(top, '.agents'), { recursive: true })

  const missing = weaver(top, ['doctor'])

  assert.equal(missing.status, 1)
  assert.ok(
    missing.lines.includes(
      'PROBLEM .agents/skills/wv-finish.md is missing, and agents are pointed to it. Run weaver install to write a template.',
    ),
  )
})

const RULES = { N1: { level: 'llm', statement: 'A name says what it holds.' } }

test('a reviewer that starts, with its skill and rules to judge, is alive', () => {
  const review = { runtime: 'codex', reviewers: { codex: { model: 'gpt-5.5' } }, skill: 'docs/review.md' }

  writeJson(top, 'weaver.config.json', { version: 1, review, rules: RULES })
  weaver(top, ['install', 'claude'])

  const { status, lines } = weaver(top, ['doctor'])

  assert.equal(status, 0, lines.join('\n'))
  assert.deepEqual(lines.slice(1, 5), [
    'ok      the review: by codex, for 1 rule(s) of level llm',
    '-       the claude command does not start: a request marked #critical has no reviewer',
    'ok      the reviewer codex on gpt-5.5 starts',
    'ok      the review skill: docs/review.md',
  ])
})

test('a reviewer whose command does not start, whose skill is missing, or that the end of a turn cannot wait for is a problem', () => {
  const review = { runtime: 'claude', skill: 'docs/review.md', waitSeconds: 3000 }

  writeJson(top, 'weaver.config.json', { version: 1, review, rules: RULES })

  const { status, lines } = weaver(top, ['doctor'])

  assert.equal(status, 1)
  assert.deepEqual(lines.slice(1, 5), [
    'ok      the review: by claude, for 1 rule(s) of level llm',
    'PROBLEM claude may review here, and the claude command does not start: its reviews fail.',
    'PROBLEM docs/review.md is missing, and the reviewer is pointed to it. Run weaver install to write a template.',
    'PROBLEM the checks (1200 s) and the wait for a review (3000 s) may last longer than the 3600 s the end of a turn is given: lower finish.deadlineSeconds or review.waitSeconds.',
  ])
})

test('when either runtime may be the one that reviews, both must start', () => {
  writeJson(top, 'weaver.config.json', { version: 1, review: { runtime: 'other', experiments: true }, rules: RULES })

  assert.deepEqual(weaver(top, ['doctor']).lines.slice(1, 4), [
    'ok      the review: by the runtime that did not write the change, for 1 rule(s) of level llm, in a copy of the project where the reviewer may experiment',
    'PROBLEM claude may review here, and the claude command does not start: its reviews fail.',
    'ok      the reviewer codex starts',
  ])

  writeJson(top, 'weaver.config.json', { version: 1, review: { runtime: 'codex', critical: { paths: ['src/auth/**'] } }, rules: RULES })
  assert.ok(
    weaver(top, ['doctor']).lines.includes('PROBLEM claude may review here, and the claude command does not start: its reviews fail.'),
  )
})

test('rules of level llm without a reviewer, and a reviewer without such rules, are noted', () => {
  writeJson(top, 'weaver.config.json', { version: 1, rules: RULES })
  assert.ok(weaver(top, ['doctor']).lines.includes('-       1 rule(s) of level llm and no review section: no one judges them'))

  writeJson(top, 'weaver.config.json', { version: 1, review: { runtime: 'codex' } })
  assert.ok(weaver(top, ['doctor']).lines.includes('-       the review is by codex, and no rule is of level llm: it has nothing to judge'))
})

test('a configuration that cannot be read is a problem, with what is wrong in it', () => {
  weaver(top, ['install'])
  writeFileSync(join(top, 'weaver.config.json'), '{"version":1,"chekcs":{}}')

  const { status, lines } = weaver(top, ['doctor'])

  assert.equal(status, 1)
  assert.match(lines[0] ?? '', /^PROBLEM .*weaver\.config\.json is not a valid project declaration: chekcs is not a known field$/)
})
