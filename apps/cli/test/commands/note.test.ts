import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import { cardOf, flag } from '../fixtures/cards.ts'
import { makeProject, weaver } from '../fixtures/project.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-note-'))
const WRITTEN = { status: 0, lines: ['✓ Note written on card #1.'] }
const USAGE = ['', 'Usage: weaver note <number> [confirmed|refuted|unsure|fixed] [text]']
const notesOf = (top: string) => cardOf(top, 1).record.notes.map(({ conclusion, text }) => [conclusion, text])
let top: string
let counter = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  top = makeProject(join(scratch, `project-${String(counter)}`))
  flag(top)
})

test('the owner writes on a card from a terminal: what the line says, and what they conclude of the card if they do', async () => {
  assert.deepEqual(await weaver(top, ['note', '1', 'to look at with the next release']), WRITTEN)
  assert.deepEqual(await weaver(top, ['note', '1', 'confirmed', 'ran', 'the', 'test']), WRITTEN)

  const [first] = cardOf(top, 1).record.notes
  const { author, role, session, subagent, unit, requests } = first?.provenance ?? {}

  assert.deepEqual(notesOf(top), [
    [null, 'to look at with the next release'],
    ['confirmed', 'ran the test'],
  ])
  assert.deepEqual([author, role, session, subagent, unit, requests], ['owner', 'owner', null, null, null, []])
  assert.equal((await weaver(top, ['cards'])).lines[2], '  #1  raw (confirmed)  no call of refresh() exists under src/.')
})

test('a report is read on the standard input when the line gives no text, and only then', async () => {
  assert.deepEqual(await weaver(top, ['note', '1', 'refuted'], { input: '\nThe commit is rolled back:\n\n    ROLLBACK\n' }), WRITTEN)
  assert.deepEqual(await weaver(top, ['note', '1', 'said on the line'], { input: 'not read' }), WRITTEN)
  assert.deepEqual(notesOf(top), [
    ['refuted', 'The commit is rolled back:\n\n    ROLLBACK'],
    [null, 'said on the line'],
  ])
})

test('a note that cannot be written says why, and how a note is typed', async () => {
  const refused = (...problems: string[]) => ({
    status: 1,
    lines: ['X The note was not written:', ...problems.map((problem) => `  ${problem}`), ...USAGE],
  })

  assert.deepEqual(
    await weaver(top, ['note'], { input: 'never read' }),
    refused('The note names no card: the number of the card comes first.', 'The note says nothing: say what you did, and what it showed.'),
  )
  assert.deepEqual(await weaver(top, ['note', '1', 'fixed']), refused('The note says nothing: say what you did, and what it showed.'))
  assert.deepEqual(await weaver(top, ['note', '9', 'ran the test']), refused('No card has the number 9.'))
  assert.deepEqual(notesOf(top), [])
})

test('under an agent the command writes nothing: the hook of Weaver should have answered in its place', async () => {
  assert.deepEqual(await weaver(top, ['note', '1', 'confirmed', 'ran the test'], { under: 'claude' }), {
    status: 1,
    lines: [
      "X Nothing was written. The note of an agent is written by Weaver's hook, which answers in place of this command: reading this means that the project is not wired for claude. weaver doctor says what is missing.",
    ],
  })
  assert.deepEqual(notesOf(top), [])
})
