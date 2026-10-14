import assert from 'node:assert/strict'
import { test } from 'vitest'
import { NoteReport } from '../../src/notes/note-report.ts'
import { NoteText } from '../../src/notes/note-text.ts'

const INVESTIGATION = [
  'Ran: the test with a token of one second:',
  '',
  '    401 Unauthorized',
  '',
  'Read: `src/auth/token.ts`.',
  'Shows: the token is refused once it is a second old.',
  'It does not show which caller should refresh it.',
].join('\n')
const FIX = 'Changed: `refresh()` is called before a request, in `src/auth/client.ts`.\nVerified: ran the suite: 42 passed.\nLeft: nothing.'

test('a note that concludes reports an investigation, or a fix when it says the thing is fixed', () => {
  assert.deepEqual(
    NoteText.CONCLUSIONS.map((conclusion) => NoteReport.kindOf(conclusion)),
    ['investigation', 'investigation', 'investigation', 'fix'],
  )
  assert.equal(NoteReport.kindOf(null), null, 'a note that concludes nothing reports nothing')
})

test('a report is read field by field: a field spans lines, and a keyword is read whatever its case', () => {
  const report = new NoteReport('confirmed', INVESTIGATION)

  assert.deepEqual([report.kind, report.opening, report.problems()], ['investigation', '', []])
  assert.deepEqual(report.fields, [
    { name: 'Ran', said: 'the test with a token of one second:\n\n    401 Unauthorized' },
    { name: 'Read', said: '`src/auth/token.ts`.' },
    { name: 'Shows', said: 'the token is refused once it is a second old.\nIt does not show which caller should refresh it.' },
  ])
  assert.deepEqual(
    new NoteReport('fixed', FIX.replace('Changed:', 'changed:').replace('Left:', 'LEFT:')).fields.map(({ name }) => name),
    ['Changed', 'Verified', 'Left'],
  )
})

test('what a report comes to is what the investigation shows, or what the fix changed', () => {
  assert.equal(
    new NoteReport('refuted', INVESTIGATION).outcome,
    'the token is refused once it is a second old.\nIt does not show which caller should refresh it.',
  )
  assert.equal(new NoteReport('fixed', FIX).outcome, '`refresh()` is called before a request, in `src/auth/client.ts`.')
  assert.equal(new NoteReport('fixed', 'Removed the line that logged it.').outcome, null)
})

test('a keyword given several times is one field, and the fields come in the order of the report', () => {
  const report = new NoteReport('unsure', 'Shows: nothing yet.\nRan: `pnpm test`: 3 failed.\nRead: nothing.\nRan: `pnpm lint`: clean.')

  assert.deepEqual(report.fields, [
    { name: 'Ran', said: '`pnpm test`: 3 failed.\n`pnpm lint`: clean.' },
    { name: 'Read', said: 'nothing.' },
    { name: 'Shows', said: 'nothing yet.' },
  ])
  assert.deepEqual(report.problems(), [])
})

test('a report that leaves a field out, or leaves it empty, says which and what to write there', () => {
  assert.deepEqual(new NoteReport('confirmed', 'Ran: the test.\nShows:\n').problems(), [
    '`Read:` is missing: say what you read without running it, or that you read nothing.',
    '`Shows:` says nothing: say what this proves, and what it does not.',
  ])
  assert.deepEqual(new NoteReport('fixed', 'I removed the line that logged it.').problems(), [
    '`Changed:` is missing: say what you changed, and where.',
    '`Verified:` is missing: say how you checked it afterwards and what that showed, or that you did not.',
    '`Left:` is missing: say what is left to do, or that nothing is.',
  ])
  assert.deepEqual(new NoteReport('fixed', 'Changed: x\nVerified: y\nLeft: z').problems(), [], 'a field is not judged by its length')
})

test('a report reads the keywords of its kind only, and keeps what is said before the first of them', () => {
  const report = new NoteReport('fixed', `The card was right.\nRan: the test, which failed.\n\n${FIX}\nRan: the suite again.`)

  assert.equal(report.opening, 'The card was right.\nRan: the test, which failed.')
  assert.deepEqual(report.fields.at(-1), { name: 'Left', said: 'nothing.\nRan: the suite again.' })

  const free = new NoteReport('confirmed', 'Ran the test with a token of one second:\n\n    401 Unauthorized')

  assert.deepEqual([free.fields, free.opening], [[], 'Ran the test with a token of one second:\n\n    401 Unauthorized'])
})

test('the lines a report is asked for are those its fields are read from', () => {
  for (const kind of NoteReport.KINDS) {
    const conclusion = kind === 'fix' ? 'fixed' : 'confirmed'
    const report = new NoteReport(conclusion, NoteReport.asked(kind).join('\n'))

    assert.deepEqual([report.problems(), report.fields.length], [[], 3])
  }
})
