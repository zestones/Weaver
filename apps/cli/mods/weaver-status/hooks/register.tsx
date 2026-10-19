import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Progress, Watch } from '../types'
import { EndOfTaskView, type Mark } from './end-of-task-view.ts'

const COMMAND = 'weaver-status'
const HIDDEN = 'isHidden'
const EVERY_MS = 1000
// A Stop hook shows the end of task it started, not one an earlier hook left.
const STARTED_WITHIN_MS = 5000
// A short end of task needs no word once it is over.
const TOLD_FROM_MS = 10_000
const TOLD_FOR_MS = 8000
const MARKS: Readonly<Record<Mark, readonly [string, string]>> = {
  done: ['✓', 'success'],
  problem: ['X', 'error'],
  alert: ['!', 'warning'],
  note: ['-', 'subtle'],
  running: ['*', 'warning'],
}

const watch = atom({ plugin: 'weaver-status', key: 'watch' } as const, null)
const shown = atom({ plugin: 'weaver-status', key: 'shown' } as const, null)
const isHidden = atom({ plugin: 'weaver-status', key: 'isHidden' } as const, false)

// Weaver keeps the progress of the end of task of a session in the folder of the session, under the git folder of the
// repository: none outside one.
async function watching($: EngineInterface, cwd: string, session: string): Promise<Watch | null> {
  const { exitCode, stdout } = await $.process.run(['git', 'rev-parse', '--absolute-git-dir'], { cwd })
  const since = await $.clock.now()

  return exitCode === 0 ? { file: `${stdout.trim()}/weaver/sessions/${session}/progress.json`, since } : null
}

// The progress of the end of task the Stop hook started; null before it starts, or while what is written cannot be read.
async function progressOf($: EngineInterface, watched: Watch): Promise<Progress | null> {
  try {
    const progress = JSON.parse(await $.fs.read(watched.file)) as Progress

    return Date.parse(progress.startedAt) < watched.since - STARTED_WITHIN_MS ? null : progress
  } catch {
    return null
  }
}

// The end of a task of Weaver runs in its Stop hook and can take long. While it runs, the spinner says the step under
// way, a band above the prompt lists every step, and a toast says how it ended. /weaver-status shows or hides the band.
export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const hidden = (await $.store.get(HIDDEN)) === true

    await $.command.register({
      name: COMMAND,
      description: 'Show or hide where the end of a task of Weaver is, above the prompt',
      immediate: true,
    })
    await update($, isHidden, () => hidden)
    $.clock.every(EVERY_MS, async () => {
      const watched = await read($, watch)
      const progress = watched === null ? null : await progressOf($, watched)
      const at = await $.clock.now()

      if (progress !== null) await update($, shown, () => ({ progress, at }))
    })

    return next(e)
  })

  // A subagent that stops ends no task: Weaver checks the work when the main agent stops.
  on('classic.Stop', async ($, e, next) => {
    const watched = e.agent_id === undefined ? await watching($, e.cwd, e.session_id) : null

    if (watched === null) return next(e)

    await update($, watch, () => watched)

    try {
      return await next(e)
    } finally {
      const progress = await progressOf($, watched)
      const view = progress === null ? null : new EndOfTaskView(progress, await $.clock.now())

      await update($, watch, () => null)
      await update($, shown, () => null)
      if (view !== null && (view.took ?? 0) >= TOLD_FROM_MS) $.ui.toast(view.ended, { timeoutMs: TOLD_FOR_MS })
    }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const last = await read($, shown)

    if (last === null) return next(e)

    return next({ ...e, props: { ...e.props, message: new EndOfTaskView(last.progress, last.at).doing } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const last = await read($, shown)

    if (last === null || e.props.hasSurvey || (await read($, isHidden))) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const view = new EndOfTaskView(last.progress, last.at)
    const { steps } = view
    const names = Math.max(0, ...steps.map((step) => step.name.length))
    const times = Math.max(0, ...steps.map((step) => step.time.length))

    return (
      <Box flexDirection='column'>
        <Text bold>{view.heading}</Text>
        {steps.map((step) => {
          const [mark, color] = MARKS[step.mark]

          return (
            <Text>
              {'  '}
              <Text color={color}>{mark}</Text> {step.name.padEnd(names)} {step.time.padEnd(times)} <Text dimColor>{step.said}</Text>
            </Text>
          )
        })}
        <Text dimColor>{`/${COMMAND} hides this`}</Text>
      </Box>
    )
  })

  on('command.run', { command: COMMAND }, async ($) => {
    const hidden = !(await read($, isHidden))

    await update($, isHidden, () => hidden)
    await $.store.set(HIDDEN, hidden)

    return {
      text: hidden
        ? 'Weaver: the end of a task is no longer shown above the prompt; the spinner still says where it is.'
        : 'Weaver: the end of a task is shown above the prompt while it runs.',
    }
  })
}
