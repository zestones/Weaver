import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { flag } from '../fixtures/cards.ts'
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

test('the interface is the owner’s: it closes cards and changes them', async () => {
  flag(top)

  assert.deepEqual(await weaver(top, ['ui'], { terminal: 120, under: 'claude' }), {
    status: 1,
    lines: ["X weaver ui is the owner's: it decides or changes something, so it runs from a terminal of their own, and not under claude."],
  })
  assert.match((await weaver(top, ['help', 'ui'])).lines.join('\n'), /^Go through the cards on one screen: [^]*\nUSAGE\n {2}weaver ui\n/)
})
