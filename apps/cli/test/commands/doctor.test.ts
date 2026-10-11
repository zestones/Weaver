import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import { EngineLink } from '../../src/link/engine-link.ts'
import { RuntimeCatalog } from '../../src/runtimes/runtime-catalog.ts'
import { makeProject, REVIEW, SETTINGS, weaver, writeConfig } from '../fixtures/project.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-doctor-'))
const link = new EngineLink()
const SKILL = '.weaver/skills/wv-finish.md'
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
    'PROBLEM no .weaver/settings.json: Weaver does nothing in this project. Run weaver install.',
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
    'ok      .weaver: 0 rule(s), 0 check(s), 0 guard(s)',
    'ok      the finish skill: .weaver/skills/wv-finish.md',
    `ok      the hook starts: ${link.hook}`,
    'ok      Claude Code: wired in .claude/settings.local.json',
    '-       Codex: not wired',
    '-       an agent started outside these runtimes is not supervised',
  ])
})

test('hooks that point to a Weaver that is no longer there are a problem, and so is a hook that does not start', () => {
  const moved = new EngineLink(join(scratch, 'old-checkout/hook.js'), link.schemas)

  for (const runtime of new RuntimeCatalog().settings(top, moved, ['codex'])) runtime.install()

  const stale = weaver(top, ['doctor'])
  const dead = weaver(top, ['doctor'], moved)

  assert.equal(stale.status, 1)
  assert.ok(stale.lines.includes('PROBLEM Codex: the hooks in .codex/hooks.json point somewhere else. Run weaver install.'))
  assert.equal(dead.status, 1)
  assert.ok(dead.lines.includes(`PROBLEM the hook does not start: ${moved.hook}. Build Weaver with pnpm build.`))
})

test('a finish skill that is missing, that lists no headings, or that no longer shows one it lists, is a problem', () => {
  const header = '---\nheadings:\n  - Request\n  - To validate\n  - Found along the way\n---\n'

  weaver(top, ['install', 'claude'])
  writeFileSync(join(top, SKILL), `${header}\n## Request\n\n## To validate\n`)

  assert.ok(weaver(top, ['doctor']).lines.includes(`PROBLEM ${SKILL} does not show ## Found along the way, which its header lists.`))

  writeFileSync(join(top, SKILL), '## Request\n\n## To validate\n')
  assert.equal(
    weaver(top, ['doctor']).lines[0],
    `PROBLEM .weaver is not a valid project declaration: ${SKILL}: its header lists no \`headings\`: they are what tells Weaver that a task is finished`,
  )

  rmSync(join(top, SKILL))

  const missing = weaver(top, ['doctor'])

  assert.equal(missing.status, 1)
  assert.ok(missing.lines.includes(`PROBLEM ${SKILL} is missing, and agents are pointed to it. Run weaver install to write a template.`))
})

const RULES = { N1: 'A name says what it holds.' }

test('a reviewer that starts, with its skill and rules to judge, is alive', () => {
  const reviewers = { ...REVIEW, runtime: 'codex', reviewers: { codex: { model: 'gpt-5.5' } }, skill: 'docs/review.md' }

  writeConfig(top, { settings: SETTINGS, reviewers, rules: RULES })
  weaver(top, ['install', 'claude'])

  const { status, lines } = weaver(top, ['doctor'])

  assert.equal(status, 0, lines.join('\n'))
  assert.deepEqual(lines.slice(1, 5), [
    'ok      the review: by codex, for 1 rule(s)',
    '-       the claude command does not start: a request marked #critical has no reviewer',
    'ok      the reviewer codex on gpt-5.5 starts',
    'ok      the review skill: docs/review.md',
  ])
})

test('a reviewer whose command does not start, whose skill is missing, or that the end of a turn cannot wait for is a problem', () => {
  const reviewers = { ...REVIEW, runtime: 'claude', skill: 'docs/review.md', waitSeconds: 3000 }

  writeConfig(top, { settings: SETTINGS, reviewers, rules: RULES })

  const { status, lines } = weaver(top, ['doctor'])

  assert.equal(status, 1)
  assert.deepEqual(lines.slice(1, 5), [
    'ok      the review: by claude, for 1 rule(s)',
    'PROBLEM claude may review here, and the claude command does not start: its reviews fail.',
    'PROBLEM docs/review.md is missing, and the reviewer is pointed to it. Run weaver install to write a template.',
    'PROBLEM the checks (1200 s) and the wait for a review (3000 s) may last longer than the 3600 s the end of a turn is given: lower checks.totalTimeoutSeconds in settings.json or waitSeconds in llm/reviewers.json.',
  ])
})

test('when either runtime may be the one that reviews, both must start', () => {
  writeConfig(top, { settings: SETTINGS, reviewers: { ...REVIEW, runtime: 'other', experiments: true }, rules: RULES })

  assert.deepEqual(weaver(top, ['doctor']).lines.slice(1, 4), [
    'ok      the review: by the runtime that did not write the change, for 1 rule(s), in a copy of the project where the reviewer may experiment',
    'PROBLEM claude may review here, and the claude command does not start: its reviews fail.',
    'ok      the reviewer codex starts',
  ])

  writeConfig(top, { settings: SETTINGS, reviewers: { ...REVIEW, runtime: 'codex', critical: { paths: ['src/auth/**'] } }, rules: RULES })
  assert.ok(
    weaver(top, ['doctor']).lines.includes('PROBLEM claude may review here, and the claude command does not start: its reviews fail.'),
  )
})

test('a review that has no rule to judge is noted', () => {
  writeConfig(top, { settings: SETTINGS, reviewers: { ...REVIEW, runtime: 'codex' } })
  assert.ok(weaver(top, ['doctor']).lines.includes('-       the review is by codex, and it has no rule: it has nothing to judge'))
})

test('a configuration that cannot be read is a problem, with what is wrong in it', () => {
  weaver(top, ['install'])
  writeFileSync(join(top, '.weaver/settings.json'), JSON.stringify({ ...SETTINGS, chekcs: {} }))

  const { status, lines } = weaver(top, ['doctor'])

  assert.equal(status, 1)
  assert.match(lines[0] ?? '', /^PROBLEM \.weaver is not a valid project declaration: settings\.json: chekcs is not a known field$/)
})
