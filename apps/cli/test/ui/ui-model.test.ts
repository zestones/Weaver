import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, test } from 'vitest'
import { CloseForm } from '../../src/ui/forms/close-form.ts'
import { FilterForm } from '../../src/ui/forms/filter-form.ts'
import { LabelsForm } from '../../src/ui/forms/labels-form.ts'
import { NoteForm } from '../../src/ui/forms/note-form.ts'
import type { UiModel } from '../../src/ui/model/ui-model.ts'
import { cardOf } from '../fixtures/cards.ts'
import { makeInterfaceProject, openInterface, press } from '../fixtures/interface.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-ui-'))
const numbers = (model: UiModel): number[] => model.listed.map((card) => card.number)
const rows = (model: UiModel): string[] =>
  model.window.rows.map((row) =>
    row.kind === 'card'
      ? `#${String(row.card.number)}${row.chosen ? '*' : ''}`
      : row.kind === 'group'
        ? `rank ${String(row.rank)}: ${String(row.count)}`
        : `${String(row.count)} more`,
  )
// The box in front of the panes, as the kind of box a test knows it to be by then.
const box = <Shape>(): Shape => model.box as unknown as Shape
let top: string
let model: UiModel
let close: () => void
let counter = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  top = makeInterfaceProject(join(scratch, `project-${String(counter)}`))
  ;({ model, close } = openInterface(top))
})

afterEach(() => {
  close()
})

test('the cards that wait are listed by level, gravest first, each level under its name, and the first one is selected', () => {
  assert.deepEqual(numbers(model), [4, 1, 2, 3])
  assert.deepEqual(rows(model), ['rank 0: 1', '#4*', 'rank 1: 1', '#1', 'rank 3: 1', '#2', 'rank 4: 1', '#3'])
  assert.deepEqual([model.selected?.number, model.grouped, model.order], [4, true, 'level'])
  assert.deepEqual(
    (['open', 'answered', 'closed', 'all'] as const).map((view) => model.countOf(view)),
    [4, 1, 1, 5],
  )
  assert.deepEqual(
    [model.ageOf(cardOf(top, 1)), model.agoOf('2026-10-11T12:40:00.000Z'), model.agoOf('2026-10-08T12:00:00.000Z')],
    ['3h', '20m', '3d'],
  )
})

test('the arrows move in the list and turn the views; s puts the newest first, with no level above them', () => {
  press(model, 'down', 'j')
  assert.equal(model.selected?.number, 2)
  press(model, 'up', 'k', 'k')
  assert.equal(model.selected?.number, 4, 'the list stops at its first card')

  press(model, 's')
  assert.deepEqual([numbers(model), model.grouped, model.selected?.number], [[4, 3, 2, 1], false, 4], 'the selected card stays the same')
  assert.deepEqual(rows(model), ['#4*', '#3', '#2', '#1'])

  press(model, 'right')
  assert.deepEqual([model.view, numbers(model)], ['answered', [4]])
  press(model, 'right')
  assert.deepEqual([model.view, numbers(model), model.selected?.standing], ['closed', [5], 'closed (wontfix)'])
  press(model, 'right', 'right')
  assert.equal(model.view, 'open', 'after the last view comes the first')
})

test('a list that does not fit its pane shows the cards around the selected one, and says how many are out of sight', () => {
  model.resized(120, 14)
  assert.deepEqual(rows(model), ['rank 0: 1', '#4*', '3 more'], 'the name of a level never stands without one of its cards')
  press(model, 'down', 'down', 'down')
  assert.deepEqual(rows(model).at(-1), '#3*')
  assert.match(rows(model)[0] ?? '', /^\d more$/)
})

test('the list is narrowed in the filter box, by labels and by date, and searched by what the cards say', () => {
  press(model, 'f')
  assert.ok(model.box instanceof FilterForm)
  press(model, 'right', 'down', 'space')
  assert.deepEqual(box<FilterForm>().chosen, { area: ['client'] })
  press(model, 'enter')
  assert.deepEqual([model.box, numbers(model), model.labels], [null, [2], { area: ['client'] }])

  press(model, 'f', 'x', 'right', 'right', 'right', 'space', 'enter')
  assert.deepEqual([model.since, numbers(model)], ['today', [4, 1, 2, 3]], 'every card of the fixture was made today')
  press(model, 'f', 'x', 'esc')
  assert.equal(model.since, 'today', 'a box that is left changes nothing')

  press(model, 'f', 'x', 'enter', '/', 'type:cache', 'enter')
  assert.deepEqual([model.searching, model.words.text, numbers(model)], [false, 'cache', [2]])
  press(model, '/', 'esc')
  assert.deepEqual([model.words.text, numbers(model).length], ['', 4])
})

test('a card is closed in its box: what someone concluded gives how, and the reason the owner keeps or corrects', () => {
  press(model, 'c')

  const closing = box<CloseForm>()

  assert.ok(closing instanceof CloseForm)
  assert.deepEqual(
    [closing.card.number, closing.closing, closing.reason.text, closing.taken?.by.author],
    [4, 'fixed', 'Removed the line that logged it.', 'claude'],
  )

  assert.equal(closing.typing, true, 'a reason taken from a note is where the keys go')
  press(model, 'type: (abc1234)', 'enter')
  assert.deepEqual([model.box, model.said], [null, { text: 'Card #4 closed as fixed.', problem: false }])
  assert.deepEqual([cardOf(top, 4).record.closing?.reason, cardOf(top, 4).state], ['Removed the line that logged it. (abc1234)', 'closed'])
  assert.deepEqual([numbers(model), model.selected?.number], [[1, 2, 3], 1], 'the card that took its place is selected')

  press(model, 'c', 'w', 'enter')
  assert.equal(box<CloseForm>().problem, 'Closing card #1 as wontfix needs a reason.')
  press(model, 'tab', 'type:the token lives an hour', 'enter')
  assert.deepEqual([model.box, cardOf(top, 1).standing], [null, 'closed (wontfix)'])

  press(model, 'c', 'v', 'tab', 'type:f', 'up', 'up')
  assert.deepEqual(
    [box<CloseForm>().closing, box<CloseForm>().reason.text],
    ['wontfix', 'f'],
    'the arrows pick how it closes wherever the keys go, and a letter typed in the reason picks nothing',
  )
  press(model, 'esc')
  assert.deepEqual([cardOf(top, 2).state, model.said], ['open', null], 'a box that is left closes nothing')
})

test('a note is written in its box, with what it concludes, and the labels of a card are changed in theirs', () => {
  press(model, 'down', 'n')
  assert.ok(model.box instanceof NoteForm)
  press(model, 'type:Read it again.', 'enter', 'type:Still true.', 'tab', 'ctrl+s')

  const [written] = cardOf(top, 1).record.notes

  assert.deepEqual([written?.text, written?.conclusion, written?.provenance.role], ['Read it again.\nStill true.', 'confirmed', 'owner'])
  assert.deepEqual([model.box, model.said?.text, model.selected?.standing], [null, 'Note written on card #1.', 'open (confirmed)'])

  press(model, 'n', 'ctrl+s')
  assert.match(box<NoteForm>().problem ?? '', /^The note says nothing/)
  press(model, 'ctrl+e')
  assert.equal(box<NoteForm>().editing, true)
  model.edited('Written in the editor.\n')
  assert.deepEqual([box<NoteForm>().editing, box<NoteForm>().text.text], [false, 'Written in the editor.'])
  press(model, 'esc', 'l')

  const labels = box<LabelsForm>()

  assert.ok(labels instanceof LabelsForm)
  assert.deepEqual([labels.families, labels.chosen], [['level', 'area', 'type'], { level: ['high'], area: ['api'], type: ['bug'] }])
  press(model, 'down', 'down', 'space', 'right', 'down', 'space', 'right', 'down', 'space', 'enter')
  assert.deepEqual(
    cardOf(top, 1).labels(),
    ['type:debt', 'area:api', 'area:client', 'level:medium'],
    'one level and one type, and as many areas as fit',
  )
  assert.equal(model.said?.text, 'Card #1 is now labelled type:debt, area:api, area:client, level:medium.')
})

test('a key that cannot act on the selected card says why', () => {
  press(model, 'down', 'down', 'down', 'l')
  assert.deepEqual(
    [model.selected?.number, model.box, model.said],
    [3, null, { text: 'Card #3 has no labels to change: no writer wrote it up.', problem: true }],
  )
  press(model, 'right', 'right', 'c')
  assert.deepEqual(model.said, { text: 'Card #5 is closed (wontfix): there is nothing to close.', problem: true })
  press(model, 'j')
  assert.equal(model.said, null, 'what was said goes with the next key')
})

test('enter goes into the card: its sides are turned and scrolled, and esc comes back to the list', () => {
  model.resized(100, 20)
  press(model, 'enter')
  assert.deepEqual([model.focus, model.tab], ['detail', 'card'])
  assert.deepEqual(model.sheet.lines.slice(0, 3), ['▍ OBSERVATION', '', 'No call of refresh() exists under src/.'])

  press(model, '2')
  assert.equal(model.sheet.lines[0], '▍ FLAG')
  assert.ok(model.sheet.below > 0)

  const first = model.sheet.lines[1]

  press(model, 'down')
  assert.deepEqual([model.sheet.above, model.sheet.lines[0]], [1, first])
  press(model, 'G')
  assert.equal(model.sheet.below, 0)
  press(model, 'g', 'right')
  assert.deepEqual([model.tab, model.sheet.above], ['notes', 0])
  assert.match(model.sheet.lines[0] ?? '', /^▍ claude {2}● fixed {2}\d{4}-\d\d-\d\d \d\d:\d\d$/)
  press(model, 'esc', 'q')
  assert.deepEqual([model.focus, model.finished], ['list', true])
})
