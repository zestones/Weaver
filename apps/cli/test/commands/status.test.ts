import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { EndOfTaskProgress, Loop } from '@weaver/engine'
import { afterAll, beforeAll, test } from 'vitest'
import { makeProject, SETTINGS, weaver, writeConfig, writeJson } from '../fixtures/project.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-status-'))
const top = makeProject(join(scratch, 'project'))
const SESSION = '3f2a91c0-5b7e-4c1d-9a44-0d6f2e8b1c73'
const DIR = join(top, '.git/weaver/sessions', SESSION)
const MOMENT = String.raw`\d{4}-\d{2}-\d{2} \d{2}:\d{2}`
const SECONDS = String.raw`\d+ s`

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

async function hook(event: string, payload: Record<string, unknown>): Promise<void> {
  await new Loop().handle(event, ['--agent=claude'], JSON.stringify({ session_id: SESSION, cwd: top, ...payload }))
}

// One task that ends: a request, a file written, the checks that pass on it.
beforeAll(async () => {
  const call = { tool_name: 'Write', tool_input: { file_path: join(top, 'src/b.js'), content: '"fine"' }, tool_use_id: 'call-1' }

  writeConfig(top, {
    settings: SETTINGS,
    checks: {
      syntax: {
        judge: ['node', '--check', '{files}'],
        cwd: '.',
        when: ['src/**/*.js'],
        reads: 'exit',
        timeoutSeconds: 60,
        rules: { parses: 'Sources parse.' },
      },
    },
  })
  await hook('UserPromptSubmit', { prompt: 'add b\nwith a second line' })
  await hook('PreToolUse', call)
  writeJson(top, 'src/b.js', 'fine')
  await hook('PostToolUse', call)
  await hook('Stop', { last_assistant_message: 'Done.' })
})

test('weaver status says how the last end of task ended, step by step', async () => {
  const { status, lines } = await weaver(top, ['status'])

  assert.equal(status, 0)
  assert.match(lines[0] ?? '', new RegExp(`^Session 3f2a91c0 \\(claude\\) · unit 1 · ended ${MOMENT} after ${SECONDS}: passed$`))
  assert.match(lines[1] ?? '', new RegExp(`^  ✓ syntax  ${SECONDS}$`))
  assert.deepEqual(lines.slice(2), [''])
})

test('an end of task that runs says each check, how long it has run, and how long it usually takes here', async () => {
  await hook('UserPromptSubmit', { prompt: 'add c\nwith a second line' })

  const progress = new EndOfTaskProgress(DIR, 2, ['syntax', 'types'], true)

  progress.started('syntax')

  const { lines } = await weaver(top, ['status'])

  assert.match(lines[0] ?? '', new RegExp(`^Session 3f2a91c0 \\(claude\\) · unit 2 · running for ${SECONDS}, usually ${SECONDS}$`))
  assert.equal(lines[1], '  Last asked: add c')
  assert.match(lines[2] ?? '', new RegExp(`^  \\* syntax  ${SECONDS} +usually ${SECONDS}$`))
  assert.deepEqual(lines.slice(3), ['  - types   waiting', '  - review  waiting', '', 'Follow it with weaver status --watch.'])
})

test('an end of task whose hook is gone was stopped before its end: what it had not done is said not to have run', async () => {
  const progress = new EndOfTaskProgress(DIR, 3, ['syntax', 'types'], true)

  progress.started('syntax')

  const record = EndOfTaskProgress.read(DIR)

  writeFileSync(join(DIR, 'progress.json'), JSON.stringify({ ...record, pid: spawnSync('true').pid }))

  const { lines } = await weaver(top, ['status', '--watch'])

  assert.match(lines[0] ?? '', new RegExp(`^Session 3f2a91c0 \\(claude\\) · unit 3 · stopped before its end; it started ${MOMENT}$`))
  assert.deepEqual(lines.slice(2), ['  ! syntax  stopped', '  - types   not run', '  - review  not run', ''], 'a program is answered once')
})

test('weaver status --watch draws on a screen of its own until Ctrl+C, then leaves where the end of task was', async () => {
  setTimeout(() => process.emit('SIGINT'), 1500)

  const { status, lines } = await weaver(top, ['status', '--watch'], { terminal: 100 })
  const read = lines.map((line) => stripVTControlCharacters(line))
  const frames = lines.filter((line) => line.includes('\u001B[2J')).length

  assert.equal(status, 0)
  assert.ok(frames >= 2, `drawn again each second, ${String(frames)} times`)
  assert.ok(read.includes('The next end of task shows here. Ctrl+C stops.'))
  const givenBack = lines.findIndex((line) => line.includes('\u001B[?1049l'))
  const last = read.findLastIndex((line) => line.startsWith('Session'))

  assert.ok(givenBack !== -1 && last > givenBack, 'the screen is given back, with where the end of task was on it')
  assert.match(read[last] ?? '', /^Session 3f2a91c0 \(claude\) · unit 3 · stopped before its end/)
})

test('weaver status takes no other word, and says when no end of task has run', async () => {
  const { status, lines } = await weaver(top, ['status', 'now'])

  assert.equal(status, 2)
  assert.deepEqual(lines, ['Usage: weaver status [--watch]', 'Run weaver help status for what each word means.'])
  assert.deepEqual((await weaver(makeProject(join(scratch, 'empty')), ['status'])).lines, ['No end of task has run here yet.', ''])
})
