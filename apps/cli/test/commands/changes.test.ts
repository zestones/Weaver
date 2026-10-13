import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import { cardOf, finding, flag, inRegistry, write } from '../fixtures/cards.ts'
import { makeProject, SETTINGS, weaver, writeConfig } from '../fixtures/project.ts'

const NOT_WRITTEN = 'X Card #2 has no title, labels or sections to correct: the writer did not write it'
const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-changes-'))
let top: string
let counter = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

// Card 1 is a flag the writer wrote up, card 2 a finding of a review.
beforeEach(() => {
  counter += 1
  top = makeProject(join(scratch, `project-${String(counter)}`))
  flag(top)
  write(top, 1)
  finding(top)
})

test('reopen opens a closed card again, and keeps the note with it', async () => {
  inRegistry(top, (registry) => registry.closeCard(1, 'wontfix', 'not now'))

  assert.deepEqual(await weaver(top, ['cards', 'reopen', '1', 'it', 'came', 'back']), {
    status: 0,
    lines: ['✓ Card #1 waits for you again.'],
  })

  const { state, closing, history } = cardOf(top, 1).record

  assert.deepEqual([state, closing], ['open', null])
  assert.deepEqual([history.at(-1)?.action, history.at(-1)?.note], ['reopened', 'it came back'])
  assert.deepEqual(await weaver(top, ['cards', 'reopen', '1']), { status: 1, lines: ['X Card #1 is not closed: it is open'] })
})

test('retitle corrects the title of a card the writer wrote', async () => {
  assert.deepEqual(await weaver(top, ['cards', 'retitle', '1', 'The', 'token', 'is', 'never', 'refreshed']), {
    status: 0,
    lines: ['✓ Card #1 is now titled: The token is never refreshed'],
  })
  assert.equal(cardOf(top, 1).title, 'The token is never refreshed')
  assert.deepEqual(await weaver(top, ['cards', 'retitle', '2', 'A', 'cast']), { status: 1, lines: [NOT_WRITTEN] })
  assert.deepEqual(await weaver(top, ['cards', 'retitle', '1']), {
    status: 2,
    lines: ['Usage: weaver cards retitle <number> <title>', 'Run weaver help cards retitle for what each word means.'],
  })
})

test('label replaces the labels of a card with labels the project declares', async () => {
  const usage = ['Usage: weaver cards label <number> [--set] <family:value>...', 'Run weaver help cards label for what each word means.']

  writeConfig(top, {
    settings: SETTINGS,
    labels: { type: { bug: 'It is broken.', debt: 'It works and costs.' }, area: { auth: 'Who signs in.' } },
  })

  assert.deepEqual(await weaver(top, ['cards', 'label', '1', 'type:debt', 'area:auth', 'type:bug', 'type:debt']), {
    status: 0,
    lines: ['✓ Card #1 is now labelled type:debt, type:bug, area:auth.'],
  })
  assert.deepEqual(cardOf(top, 1).record.written?.labels, { type: ['debt', 'bug'], area: ['auth'] })
  assert.deepEqual(await weaver(top, ['cards', 'label', '1', 'type:feature', 'area:auth', 'size:small']), {
    status: 1,
    lines: ['X Type:feature, size:small: not labels of this project, which declares its labels in .weaver/project/labels.json'],
  })
  assert.deepEqual(cardOf(top, 1).labels(), ['type:debt', 'type:bug', 'area:auth'])
  assert.deepEqual(await weaver(top, ['cards', 'label', '2', 'type:bug']), { status: 1, lines: [NOT_WRITTEN] })
  assert.deepEqual(await weaver(top, ['cards', 'label', '1', '--set', 'area:auth']), {
    status: 0,
    lines: ['✓ Card #1 is now labelled type:debt, type:bug, area:auth.'],
  })
  assert.deepEqual(await weaver(top, ['cards', 'label', '1', '--set', 'type:bug']), {
    status: 0,
    lines: ['✓ Card #1 is now labelled type:bug, area:auth.'],
  })
  assert.deepEqual(
    cardOf(top, 1).record.written?.labels,
    { type: ['bug'], area: ['auth'] },
    'the families named are replaced, the others kept',
  )
  assert.deepEqual(await weaver(top, ['cards', 'label', '1', '--set']), { status: 2, lines: usage })
  assert.deepEqual(await weaver(top, ['cards', 'label', '1']), { status: 2, lines: usage })
  assert.deepEqual(await weaver(top, ['cards', 'label', '1', 'bug']), { status: 2, lines: usage })
})

test('rewrite replaces the sections of a card with the Markdown it reads, cut at its headings', async () => {
  const input = [
    '## Observation',
    '',
    'Nothing calls `refresh()`.',
    '',
    '```sh',
    '## not a heading',
    '```',
    '',
    '## Context  ',
    'Seen while reading the callers of `getToken`.',
    '',
  ].join('\n')

  assert.deepEqual(await weaver(top, ['cards', 'rewrite', '1'], { input }), {
    status: 0,
    lines: ['✓ Card #1 is rewritten, with the sections Observation, Context.'],
  })
  assert.deepEqual(cardOf(top, 1).record.written?.sections, [
    { name: 'Observation', text: 'Nothing calls `refresh()`.\n\n```sh\n## not a heading\n```' },
    { name: 'Context', text: 'Seen while reading the callers of `getToken`.' },
  ])
  assert.deepEqual(await weaver(top, ['cards', 'rewrite', '1'], { input: 'Nothing calls it.\n' }), {
    status: 1,
    lines: ['X The text read starts before its first "## " heading: those lines belong to no section'],
  })
  assert.deepEqual(await weaver(top, ['cards', 'rewrite', '1'], { input: '\n' }), {
    status: 1,
    lines: ['X The text read has no "## " heading: each section starts with one'],
  })
  assert.equal(cardOf(top, 1).record.written?.sections.length, 2, 'a text that cannot be used changes nothing')
  assert.deepEqual(await weaver(top, ['cards', 'rewrite', '2'], { input }), { status: 1, lines: [NOT_WRITTEN] })
  assert.deepEqual(await weaver(top, ['cards', 'rewrite', '1', 'now'], { input }), {
    status: 2,
    lines: ['Usage: weaver cards rewrite <number>', 'Run weaver help cards rewrite for what each word means.'],
  })
})

test('tie holds two cards together, with its note, and untie undoes it', async () => {
  assert.deepEqual(await weaver(top, ['cards', 'tie', '1', '2', 'both', 'about', 'the', 'token']), {
    status: 0,
    lines: ['✓ Cards #1 and #2 are tied.'],
  })
  assert.deepEqual([cardOf(top, 1).record.ties, cardOf(top, 2).record.ties], [[2], [1]])
  assert.equal(cardOf(top, 2).record.history.at(-1)?.note, 'to #1: both about the token')
  assert.deepEqual(await weaver(top, ['cards', 'tie', '2', '1']), { status: 1, lines: ['X Cards #2 and #1 are already tied'] })
  assert.deepEqual(await weaver(top, ['cards', 'untie', '2', '1']), { status: 0, lines: ['✓ Cards #2 and #1 are no longer tied.'] })
  assert.deepEqual([cardOf(top, 1).record.ties, cardOf(top, 2).record.ties], [[], []])
  assert.deepEqual(await weaver(top, ['cards', 'untie', '1', '2']), { status: 1, lines: ['X Cards #1 and #2 are not tied'] })
  assert.deepEqual(await weaver(top, ['cards', 'tie', '1', '9']), { status: 1, lines: ['X No card has the number 9'] })
  assert.deepEqual(await weaver(top, ['cards', 'tie', '1']), {
    status: 2,
    lines: ['Usage: weaver cards tie <a> <b> [note]', 'Run weaver help cards tie for what each word means.'],
  })
  assert.deepEqual(await weaver(top, ['cards', 'untie', '1', '2', 'now']), {
    status: 2,
    lines: ['Usage: weaver cards untie <a> <b>', 'Run weaver help cards untie for what each word means.'],
  })
})

test('separate undoes a merge: the card is a card again, and the other loses the occurrence', async () => {
  inRegistry(top, (registry) => registry.merge(2, 1, 'the same token'))

  assert.equal(cardOf(top, 1).record.occurrences.length, 1)
  assert.deepEqual(await weaver(top, ['cards', 'separate', '2']), { status: 0, lines: ['✓ Card #2 is a card of its own again, open.'] })
  assert.deepEqual([cardOf(top, 2).state, cardOf(top, 2).record.mergedInto], ['open', null])
  assert.deepEqual(cardOf(top, 1).record.occurrences, [])
  assert.deepEqual(await weaver(top, ['cards', 'separate', '2']), { status: 1, lines: ['X Card #2 is not merged into another'] })
  assert.deepEqual(await weaver(top, ['cards', 'separate', 'two']), {
    status: 2,
    lines: ['Usage: weaver cards separate <number>', 'Run weaver help cards separate for what each word means.'],
  })
})

test('words that cannot be used create no registry', async () => {
  const empty = makeProject(join(scratch, 'empty'))

  assert.equal((await weaver(empty, ['cards', 'reopen'])).status, 2)
  assert.equal((await weaver(empty, ['cards', 'tie', '1', 'two'])).status, 2)
  assert.equal((await weaver(empty, ['close', '1', 'later'])).status, 2)
  assert.equal(existsSync(join(empty, '.git/weaver')), false)
})
