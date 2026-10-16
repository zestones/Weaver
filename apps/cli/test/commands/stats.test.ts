import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Loop } from '@weaver/engine'
import { afterAll, beforeAll, test } from 'vitest'
import type { ProjectFigures } from '../../src/numbers/stats-page.ts'
import { flag, note } from '../fixtures/cards.ts'
import { makeProject, SETTINGS, weaver, writeConfig, writeJson } from '../fixtures/project.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-stats-'))
const top = makeProject(join(scratch, 'project'))
const SESSION = '3f2a91c0-5b7e-4c1d-9a44-0d6f2e8b1c73'
const USAGE = 'Usage: weaver stats [--since <day>|<n>d] [--json]'
// Every run of the hook is said to have taken this long.
const HOOK_MS = 120
let calls = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

async function hook(event: string, payload: Record<string, unknown>): Promise<void> {
  const loop = new Loop(undefined, undefined, undefined, () => HOOK_MS)

  await loop.handle(event, ['--agent=claude'], JSON.stringify({ session_id: SESSION, cwd: top, ...payload }))
}

async function writes(path: string, content: string): Promise<void> {
  calls += 1

  const call = { tool_name: 'Write', tool_input: { file_path: join(top, path), content }, tool_use_id: `call-${String(calls)}` }

  await hook('PreToolUse', call)
  writeJson(top, path, content)
  await hook('PostToolUse', call)
}

const figures = async (...args: string[]): Promise<ProjectFigures> =>
  JSON.parse((await weaver(top, ['stats', '--json', ...args])).lines.join('\n')) as ProjectFigures

// One task of an agent: a request, a file that does not parse, a refusal by the checks, the file put right, and a
// call a guard refuses. JSON is a file `node --check` reads as a script: a string parses, an object does not.
beforeAll(async () => {
  const parses = ['node', '--check', '{files}']

  writeConfig(top, {
    settings: SETTINGS,
    checks: {
      syntax: {
        warn: parses,
        judge: parses,
        cwd: '.',
        when: ['src/**/*.js'],
        reads: 'exit',
        timeoutSeconds: 60,
        rules: { parses: 'Sources parse.' },
      },
    },
    guards: { tools: { statement: 'The tools are the owner’s.', writes: ['tools/**'] } },
  })
  await hook('UserPromptSubmit', { prompt: 'add b #review', transcript_path: '/somewhere/transcript.jsonl' })
  await writes('src/b.js', { broken: true } as unknown as string)
  await hook('Stop', { last_assistant_message: 'Done.' })
  await writes('src/b.js', 'fine')
  await hook('Stop', { last_assistant_message: 'Done.' })
  await hook('PreToolUse', { tool_name: 'Write', tool_input: { file_path: join(top, 'tools/x.mjs'), content: '' }, tool_use_id: 'refused' })
  flag(top)
  note(top, 1)
  note(top, 1, { conclusion: null, text: 'To fix with the session store.' })
})

test('weaver stats counts what the journal and the registry hold, as a program reads it', async () => {
  const { since, journal, cards } = await figures()

  assert.equal(since, null)
  assert.deepEqual(journal.sessions, { total: 1, byAgent: { claude: 1 }, continued: 0 })
  assert.deepEqual(journal.requests, { total: 1, directives: { '#review': 1 } })
  assert.deepEqual(journal.turns, { total: 2, finished: 2, heldByChecks: 1, heldByReview: 0, heldByReminder: 0, heldByCards: 0 })
  assert.deepEqual(
    [
      journal.verdicts.total,
      journal.verdicts.passed,
      journal.verdicts.failed,
      journal.verdicts.files.median,
      journal.verdicts.lines.largest,
    ],
    [2, 1, 1, 1, 3],
  )
  assert.deepEqual(journal.units, { settled: 1, byVerdict: 1, withNoFile: 0, byOwner: 0 })
  assert.deepEqual(
    Object.entries(journal.checks).map(([id, { ran, passed, failed, timedOut, skipped, ms }]) => [
      id,
      ran,
      passed,
      failed,
      timedOut,
      skipped,
      ms.count,
    ]),
    [['syntax', 2, 1, 1, 0, 0, 2]],
  )
  assert.equal(journal.warnings.calls, 2)
  assert.deepEqual(
    Object.entries(journal.warnings.checks).map(([id, { ran, warned, timedOut }]) => [id, ran, warned, timedOut]),
    [['syntax', 2, 1, 0]],
  )
  assert.deepEqual(
    Object.entries(journal.hooks).map(([event, ms]) => [event, ms.count, ms.median, ms.total]),
    [
      ['UserPromptSubmit', 1, HOOK_MS, HOOK_MS],
      ['PreToolUse', 3, HOOK_MS, 3 * HOOK_MS],
      ['PostToolUse', 2, HOOK_MS, 2 * HOOK_MS],
      ['Stop', 2, HOOK_MS, 2 * HOOK_MS],
    ],
  )
  assert.deepEqual(journal.calls, { changingFiles: 2, movingHead: 0 })
  assert.deepEqual(journal.guards, { tools: { refused: 1, lifted: 0 } })
  assert.deepEqual(journal.errors, { total: 0, byEvent: {} })
  assert.deepEqual(Object.keys(journal.byWeaver), ['0.0.0-dev'])
  assert.deepEqual(cards?.opened, { total: 1, byOrigin: { flag: 1 } })
  assert.deepEqual([cards?.waiting.total, cards?.waiting.notWritten, cards?.written, cards?.closed.total], [1, 1, 0, 0])
  assert.equal(cards?.waiting.oldestAt, '2026-10-11T10:00:00.000Z')
  assert.deepEqual(cards?.notes, { total: 2, byConclusion: { confirmed: 1 } })
})

test('weaver stats prints the same numbers for its owner, and concludes nothing', async () => {
  const { status, lines } = await weaver(top, ['stats'])
  const text = lines.join('\n')

  assert.equal(status, 0)
  assert.match(lines[0] ?? '', /^Weaver in this project, from \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}: \d+ lines of its journal\.$/)
  assert.ok(lines.includes('Sessions                  1 (claude 1)'), text)
  assert.ok(lines.includes('Requests                  1 (#review 1)'))
  assert.ok(lines.includes('Calls                     2 changed files, 0 moved HEAD'))
  assert.ok(
    lines.includes(
      'Ends of turn              2: the agent said it had finished 2; held by the checks 1, by a review 0, by the reminder 0, for notes on cards 0',
    ),
  )
  assert.ok(lines.includes('Verdicts                  2: 1 passed, 1 failed'))
  assert.ok(lines.includes('  lines added             median 1, largest 3'))
  assert.ok(lines.includes('  files a repair rewrote  0'))
  assert.ok(lines.includes('Units of work settled     1: 1 by a verdict, 0 with no file to judge, 0 by the owner'))
  assert.match(
    text,
    /\nChecks at the end of a task\n {2}check {3}ran {2}passed {2}failed {2}out of time {2}skipped {2}findings {2}for the owner {2}for a reviewer {2}median {2}nine in ten {2}longest\n {2}syntax {4}2 {7}1 {7}1 {12}0 {8}0 {9}0 {14}0 {15}0 /,
  )
  assert.match(
    text,
    /\nWarnings right after a call: 2 calls, median .*\n {2}check {3}ran {2}warned {2}out of time .*\n {2}syntax {4}2 {7}1 {12}0 /,
  )
  assert.match(
    text,
    /\nRuns of the hook\n {2}event {13}runs {2}median {2}nine in ten {2}longest {2}in all\n {2}UserPromptSubmit {5}1 {2}0\.12 s {7}0\.12 s {3}0\.12 s {2}0\.12 s\n {2}PreToolUse {11}3 {2}0\.12 s {7}0\.12 s {3}0\.12 s {2}0\.36 s\n/,
  )
  assert.match(text, /\nGuards\n {2}guard {2}refused {2}let through in maintenance\n {2}tools {8}1 {27}0\n/)
  assert.ok(lines.includes('Maintenance               turned on 0, off 0'))
  assert.ok(lines.includes('Reviews                   0'))
  assert.ok(lines.includes('Cards opened              1 (flag 1)'))
  assert.ok(lines.includes('Notes on cards            2 (confirmed 1)'))
  assert.match(text, /^Cards waiting now {9}1; not written yet 1, the oldest since \d{4}-\d{2}-\d{2}$/m)
  assert.ok(lines.includes("Weaver's own errors       0"))
  assert.equal(lines.at(-1), `The lines themselves are in ${join(top, '.git/weaver/events')}, one file for each session.`)
})

test('the count may start from a day, or from a number of days back', async () => {
  const later = await weaver(top, ['stats', '--since', '2999-01-01'])
  const week = await figures('--since', '7d')

  assert.deepEqual(later, {
    status: 0,
    lines: ['Weaver kept nothing of this project since 2999-01-01: its journal has no line to count.'],
  })
  assert.equal(week.journal.verdicts.total, 2)
  assert.match(week.since ?? '', /^\d{4}-\d{2}-\d{2}$/)
  assert.equal((await figures('--since', '2999-01-01')).cards?.opened.total, 0, 'the cards opened are counted over the same time')

  for (const args of [['--since'], ['--since', 'yesterday'], ['--until', '7d'], ['7d']]) {
    assert.deepEqual((await weaver(top, ['stats', ...args])).lines.slice(0, 1), [USAGE], args.join(' '))
    assert.equal((await weaver(top, ['stats', ...args])).status, 2)
  }
})

test('a project where Weaver kept nothing says so, and an agent may read the numbers too', async () => {
  const empty = makeProject(join(scratch, 'empty'))

  assert.deepEqual(await weaver(empty, ['stats']), {
    status: 0,
    lines: ['Weaver kept nothing of this project yet: its journal has no line to count.'],
  })
  assert.equal((await weaver(top, ['stats'], { under: 'claude' })).status, 0)
})
