import assert from 'node:assert/strict'
import { test } from 'vitest'
import { EndOfTaskView } from '../../mods/weaver-status/hooks/end-of-task-view.ts'
import type { Progress } from '../../mods/weaver-status/types/index.js'

const progress: Progress = {
  unit: 1,
  pid: 1,
  startedAt: '2026-11-08T12:00:00Z',
  usualMs: null,
  step: 'checks',
  checks: [],
  review: null,
  endedAt: null,
  outcome: null,
}

test('the mod says plainly that nothing was checked during and after an unchecked task', () => {
  const running = new EndOfTaskView(progress, Date.parse(progress.startedAt))

  assert.match(running.doing, /nothing was checked/)
  assert.match(running.steps[0]?.said ?? '', /Nothing was checked/)
  const ended = new EndOfTaskView(
    {
      ...progress,
      step: 'over',
      endedAt: progress.startedAt,
      outcome: 'No checks are configured; nothing was checked; settled without automated validation',
    },
    Date.parse(progress.startedAt),
  )

  assert.match(ended.doing, /nothing was checked/)
  assert.match(ended.ended, /nothing was checked/)
  assert.doesNotMatch(ended.ended, /passed/)
})
