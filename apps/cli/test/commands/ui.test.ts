import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { makeProject, weaver } from '../fixtures/project.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-ui-command-'))
const top = makeProject(join(scratch, 'project'))

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

test('the interface needs a terminal, and has nothing to show in a project that holds no card', async () => {
  assert.deepEqual(await weaver(top, ['ui']), {
    status: 1,
    lines: ['X weaver ui draws a screen: it needs a terminal. weaver cards lists the cards for a program.'],
  })
  assert.deepEqual(await weaver(top, ['ui'], { terminal: 120 }), { status: 0, lines: ['Nothing waits for you.'] })
  assert.deepEqual(await weaver(top, ['ui', 'now'], { terminal: 120 }), {
    status: 2,
    lines: ['Usage: weaver ui', 'Run weaver help ui for what each word means.'],
  })
})

test('agents may open the interface; terminal requirements still apply', async () => {
  assert.deepEqual(await weaver(top, ['ui'], { terminal: 120, under: 'claude' }), { status: 0, lines: ['Nothing waits for you.'] })
  assert.match((await weaver(top, ['ui'], { under: 'claude' })).lines.join('\n'), /needs a terminal/)
})
