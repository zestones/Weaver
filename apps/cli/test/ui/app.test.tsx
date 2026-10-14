import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { afterAll, test } from 'vitest'
import { App } from '../../src/ui/app/app.tsx'
import { OwnEditor } from '../../src/ui/editor/own-editor.ts'
import { cardOf } from '../fixtures/cards.ts'
import { makeInterfaceProject, openInterface } from '../fixtures/interface.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-app-'))
const SIZE = { columns: 100, rows: 30 }
const DOWN = '\u001B[B'
const ENTER = '\r'
const ESCAPE = '\u001B'
const RIGHT = '\u001B[C'
const LEFT = '\u001B[D'
// Ink draws a key after the turn it was read in.
const drawn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60))

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

test('the screen shows the views, the list under its levels, the selected card and the keys, and follows the keys', async () => {
  const { model, close } = openInterface(makeInterfaceProject(join(scratch, 'project')))
  const screen = render(<App model={model} editor={new OwnEditor({})} size={SIZE} />)
  const frame = (): string => screen.lastFrame() ?? ''
  const typed = async (...keys: readonly string[]): Promise<void> => {
    for (const key of keys) {
      screen.stdin.write(key)
      await drawn()
    }
  }

  try {
    const lines = frame().split('\n')

    assert.equal(lines.length, SIZE.rows)
    assert.equal(lines[0], '', 'nothing stands against the top of the screen')
    assert.match(lines[1] ?? '', /^ {3}W E A V E R \/ shop {4}Open 4 {2}Answered 1 {2}Closed 1 {2}All 5 +Filter ▾ +Search +\/$/)
    assert.match(lines[3] ?? '', /^ {3}▁+ {4}▁+$/, 'a frame is drawn at the edge of its cells, where the ground of its pane ends')
    assert.match(lines[5] ?? '', /▊ {2}Cards 4 +by level ↓ {2}▎ {2}▊ {2}#4 +flagged by claude, 3h ago {2}▎/)
    assert.match(lines[7] ?? '', /▊ {2}CRITICAL 1 ─+ {2}▎/, 'a level opens its cards as a heading, with a rule to the edge')
    assert.match(lines[8] ?? '', /▊ {3}CRITICAL {3}bug {3}api {3}● fixed by claude .*:9 {2}▎/)
    assert.match(lines[9] ?? '', /▊ {2}#4 {2}Tokens are written to the log {3}▎/)
    assert.match(lines[10] ?? '', /▊ {7}● fixed {2}api +3h {2}▎/)
    assert.match(
      frame(),
      /▊ {2}Card +Flag +Investigation +Fix {2}1 +Notes /,
      'a card has its five sides, and the one that holds a report says how many',
    )
    assert.match(frame(), /▊ {2}NO LEVEL 1 ─+ {2}▎/, 'a card without a level stands after the others')
    assert.match(
      frame(),
      /▊ {2}▍ OBSERVATION +▎\n[^\n]*▊ +▎\n[^\n]*▊ {2}No call of refresh\(\) exists under src\/\./,
      'a heading has an empty line under it',
    )
    assert.equal(
      lines.at(-1),
      '   ↑↓ navigate · ←→ view · enter open · / search · f filter · n note · l label · c close   ? help',
      'the keys are one line, the last of the screen',
    )

    await typed(DOWN)
    assert.match(frame(), /▊ {2}#1 +flagged by claude, 3h ago {2}▎\n.*Nothing refreshes the token/)

    await typed(ENTER, '2')
    assert.match(frame(), /▊ {2}▍ FLAG +▎\n[^\n]*\n[^\n]*▊ {2}Seen {6}no call of refresh\(\) exists under/)
    assert.match(frame().split('\n').at(-1) ?? '', /^ {3}↑↓ scroll · ←→ side · esc back · n note · l label · c close +\? help$/)

    await typed(ESCAPE, 'c')
    assert.match(frame(), /Close #1 +esc/)
    assert.match(
      frame(),
      /▊▔+▎[^\n]*\n[^\n]*▊ {2}Close #1 +esc {3}▎/,
      'the line above a box is on a row of the box itself: nothing of the box lies beyond it',
    )
    assert.match(frame(), /f {3}fixed {6}it was fixed/)
    await typed('w', '\t', 'wanted', ENTER)
    assert.equal(cardOf(join(scratch, 'project'), 1).standing, 'closed (wontfix)')
    assert.equal(
      frame().split('\n').at(-1),
      '   ✓ Card #1 closed as wontfix.',
      'what was done is said where the keys are, until the next key',
    )
    assert.match(frame(), /Open 3 /)

    await typed(RIGHT, RIGHT)
    assert.match(frame(), /▊ {2}Cards 2 +by closing ↓ {2}▎/, 'the closed cards stand under how they were closed')
    assert.match(frame(), /▊ {2}WONTFIX 2 ─+ {2}▎/)
    await typed(LEFT, LEFT)

    await typed('?')
    assert.match(frame(), /Keys +esc/)
    await typed('x', 'q')
    assert.equal(model.finished, true)
  } finally {
    screen.unmount()
    close()
  }
})

test('a window too small for the panes says so, and still lets the owner leave', async () => {
  const { model, close } = openInterface(makeInterfaceProject(join(scratch, 'small')))
  const screen = render(<App model={model} editor={new OwnEditor({})} size={{ columns: 60, rows: 12 }} />)

  try {
    assert.match(screen.lastFrame() ?? '', /This window is 60 columns by 12 rows: the cards need 90 by\s+22 at least/)
    screen.stdin.write('q')
    await drawn()
    assert.equal(model.finished, true)
  } finally {
    screen.unmount()
    close()
  }
})
