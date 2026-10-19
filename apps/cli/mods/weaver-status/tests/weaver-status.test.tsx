import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Progress } from '../types'

const NOW = Date.parse('2026-10-19T10:00:00.000Z')
const SESSION = '3f2a91c0-5b7e-4c1d-9a44-0d6f2e8b1c73'
const FILE = `/project/.git/weaver/sessions/${SESSION}/progress.json`
const at = (seconds: number): string => new Date(NOW + seconds * 1000).toISOString()
const BAND = {
  plugin: 'weaver-status',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 }, view: {} },
} as const
const SPINNER = {
  plugin: 'weaver-status',
  surface: 'terminal',
  component: 'Spinner',
  props: { word: 'Sauteing', message: 'running stop hooks', suffix: '…', mode: 'tool-use' },
} as const

// The end of a task as Weaver keeps it, half a minute after its Stop hook started: one check passed, one runs, one
// waits, then the review.
const RUNNING: Progress = {
  unit: 12,
  pid: 4242,
  startedAt: at(1),
  usualMs: 28 * 60_000,
  step: 'checks',
  checks: [
    { id: 'lint', status: 'pass', startedAt: at(1), ms: 14_000, kept: false, usualMs: 15_000 },
    { id: 'backend', status: 'running', startedAt: at(15), ms: null, kept: false, usualMs: 21 * 60_000 + 40_000 },
    { id: 'frontend', status: 'waiting', startedAt: null, ms: null, kept: false, usualMs: 190_000 },
  ],
  review: { status: 'waiting', startedAt: null, endedAt: null, standing: null, reviewer: null, usualMs: 372_000 },
  endedAt: null,
  outcome: null,
}
const OVER: Progress = {
  ...RUNNING,
  step: 'over',
  checks: RUNNING.checks.map((check) => ({ ...check, status: 'pass', startedAt: check.startedAt ?? at(40), ms: 20_000 })),
  review: { ...RUNNING.review!, status: 'over', startedAt: at(45), endedAt: at(58), standing: 'clean', reviewer: 'codex' },
  endedAt: at(59),
  outcome: 'passed',
}

// The machine beneath the mod: a repository at /project, a progress file Weaver writes as the test says, and the
// engine's own drawing, which says what the spinner was given to say.
function project(on: On, written: { progress: Progress | null }, toasts: string[], said: (string | null)[] = []): void {
  on('ui.render', (_$, e) => {
    if (e.component === 'Spinner') said.push(e.props.message)

    return { type: 'Box', props: {}, children: [] }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '/project/.git\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('fs.read', (_$, e) =>
    e.path === FILE && written.progress !== null ? { value: JSON.stringify(written.progress) } : { deny: 'ENOENT' },
  )
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
}

test('while the Stop hook of Weaver runs, the chat says where its end of task is, and then how it ended', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const written: { progress: Progress | null } = { progress: null }
  const toasts: string[] = []
  const said: (string | null)[] = []

  mock.store(on)
  project(on, written, toasts, said)
  on('classic.Stop', () => clock.sleep(60_000).then(() => ({})))

  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })

  const stop = $.classic.Stop({ stop_hook_active: false, session_id: SESSION, cwd: '/project' })

  written.progress = RUNNING
  await clock.advance(30_000)

  const band = await $.ui.mount(BAND)
  const texts = (await band.findAll({ type: 'Text' })).map((text) => text.text)

  expect(texts).toContain('Weaver · end of task, unit 12 · 29 s, usually 28 min 0 s')
  expect(texts.some((text) => /\* backend +15 s +usually 21 min 40 s/.test(text))).toBe(true)
  expect(texts.some((text) => /- review +waiting +usually 6 min 12 s/.test(text))).toBe(true)

  await $.ui.mount(SPINNER)

  expect(said.at(-1)).toBe('Weaver · backend 15 s, usually 21 min 40 s · 1 of 3 checks done')

  written.progress = OVER
  await clock.advance(30_000)
  await stop

  expect(toasts).toEqual(['Weaver: passed, after 58 s'])
  expect(await (await $.ui.mount(BAND)).find({ text: /end of task/ })).toBeUndefined()
})

test('/weaver-status hides the band, and the owner’s choice is kept for the next sessions', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const written: { progress: Progress | null } = { progress: RUNNING }
  const stored = new Map<string, unknown>()

  on('store.get', (_$, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_$, e) => {
    stored.set(e.key, e.value)

    return { value: undefined }
  })
  project(on, written, [])
  on('classic.Stop', () => clock.sleep(60_000).then(() => ({})))

  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })

  const stop = $.classic.Stop({ stop_hook_active: false, session_id: SESSION, cwd: '/project' })

  await clock.advance(5000)

  const hidden = await $.command.run({
    command: 'weaver-status',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })

  expect(hidden).toMatchObject({ text: expect.stringContaining('no longer shown') })
  expect(await (await $.ui.mount(BAND)).find({ text: /end of task/ })).toBeUndefined()
  expect(stored.get('isHidden')).toBe(true)

  await clock.advance(60_000)
  await stop
})

test('the stop of a subagent ends no task, and is not watched', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const runs: string[][] = []

  mock.store(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('process.run', (_$, e) => {
    runs.push([...e.argv])

    return { value: { exitCode: 0, stdout: '/project/.git\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('classic.Stop', () => ({}))

  await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
  await $.classic.Stop({ stop_hook_active: false, session_id: SESSION, cwd: '/project', agent_id: 'a406db5d5f6bb15fe' })
  await clock.advance(2000)

  expect(runs).toEqual([])
})
