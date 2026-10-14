import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { DrawnCode } from '../../src/markdown/drawn-code.ts'
import { TerminalMarkdown } from '../../src/markdown/terminal-markdown.ts'
import { WrappedLines } from '../../src/markdown/wrapped-lines.ts'
import { Paint } from '../../src/output/paint.ts'
import { CardSheet } from '../../src/ui/sheet/card-sheet.ts'
import { CardSides, type SheetTab } from '../../src/ui/sheet/card-sides.ts'
import { ThemePaint } from '../../src/ui/theme/theme-paint.ts'
import { THEME } from '../../src/ui/theme/theme.ts'
import { cardOf, contextOf, finding, flag, inRegistry, note, write } from '../fixtures/cards.ts'
import { makeProject } from '../fixtures/project.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-sheet-'))
const top = makeProject(join(scratch, 'project'))
const plain = new Paint(false)
const ESC = String.fromCharCode(27)
const ink = (colour: string): string =>
  `${ESC}[38;2;${[1, 3, 5].map((at) => String(Number.parseInt(colour.slice(at, at + 2), 16))).join(';')}m`
const ground = (colour: string): string => ink(colour).replace('[38;', '[48;')

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

test('a card is drawn one side at a time: what was written of it, the flag it comes from, what was looked into since', () => {
  flag(top, { context: [contextOf('src/auth/token.ts', 42, '    return cached')] })
  write(top, 1)
  note(top, 1)
  inRegistry(top, (registry) => registry.closeCard(1, 'issue', 'for the next release', 'https://issues.example/42'))

  const sheet = new CardSheet(cardOf(top, 1), plain, 64)

  assert.deepEqual(
    sheet.lines('card'),
    ['▍ OBSERVATION', '', 'No call of refresh() exists under src/.', '', '', '▍ UNCERTAINTIES', '', 'The application was not run.'],
    'a heading has an empty line under it and two above it: it belongs to what follows',
  )
  assert.deepEqual(sheet.lines('flag').slice(0, 10), [
    '▍ FLAG',
    '',
    'Seen      no call of refresh() exists under src/.',
    'Expected  the token is refreshed before a request goes out.',
    'Found     I was looking for the callers of getToken for my task.',
    'Checked   grep over src/. I did not run the application.',
    'Did       left as it is',
    '',
    'src/auth/token.ts:42 as it was when flagged, lines from before',
    'the unit of work',
  ])
  assert.ok(sheet.lines('flag').includes('▸ 42 │ return cached'), 'without grounds, code stands behind its bar')

  const closing = sheet.lines('flag').slice(sheet.lines('flag').indexOf('▍ CLOSING'))

  assert.match(closing[3] ?? '', /^On {8}\d{4}-\d\d-\d\d \d\d:\d\d$/)
  assert.deepEqual(
    [...closing.slice(0, 3), ...closing.slice(4)],
    [
      '▍ CLOSING',
      '',
      'As        issue',
      'Reason    for the next release',
      'Issue     https://issues.example/42',
      '',
      '',
      '▍ WHERE IT COMES FROM',
      '',
      'Session   session-1, unit 1',
      '',
      'Writer    codex: agrees with the flag. Read src/auth/token.ts:',
      '          refresh() is defined and never called.',
      '',
      'Asked     refresh the token before it expires',
    ],
    'fields that run over a line are set apart by an empty one',
  )
  assert.match(sheet.lines('investigation')[0] ?? '', /^▍ claude {2}✓ confirmed {2}\d{4}-\d\d-\d\d \d\d:\d\d$/)
  assert.deepEqual(
    sheet.lines('investigation').slice(1),
    ['', 'Ran the test with a token of one second:', '', '  │ 401 Unauthorized'],
    'a note that gives no field of a report is drawn as the text it is',
  )
  assert.deepEqual(
    CardSides.TABS.map((tab) => new CardSides(cardOf(top, 1)).holds(tab)),
    [true, true, true, false, false],
    'a card has its five sides whether or not something was written on the last three',
  )
})

test('a card nobody wrote up shows its flag, one a review left shows what the review said, and one without notes says so', () => {
  flag(top, { text: 'Seen: the cache is never emptied.\nExpected: x.\nFound: y.\nChecked: z.\nDid: left as it is.', places: [] })
  finding(top, { quote: 'const user = raw as User', suggestion: 'Parse it with the schema.' })

  const raw = new CardSheet(cardOf(top, 2), plain, 64)
  const found = new CardSheet(cardOf(top, 3), plain, 64)

  assert.deepEqual(raw.lines('card').slice(0, 3), [
    'No writer has written this card up yet. Its flag says:',
    '',
    'Seen      the cache is never emptied.',
  ])
  assert.deepEqual(
    [raw.lines('investigation'), raw.lines('fix'), raw.lines('notes')],
    [['Nobody has looked into this card yet.'], ['Nobody has reported a fix of this card yet.'], ['Nothing is written on this card yet.']],
    'a side nothing was written on says so',
  )
  assert.deepEqual(found.lines('card'), [
    '▍ FINDING',
    '',
    'The response is cast to User without being parsed.',
    '',
    'Review    3f9a2c1/F1',
    'Rule      N2: No cast of external data.',
    'Waits     not fixed by the agent: the owner asked for it',
    '',
    '',
    '▍ THE LINE AS THE REVIEWER READ IT',
    '',
    '  │ const user = raw as User',
    '',
    '',
    '▍ SUGGESTION',
    '',
    'Parse it with the schema.',
  ])
  assert.deepEqual(
    found.lines('flag').slice(0, 3),
    ['▍ WHERE IT COMES FROM', '', 'Session   session-1, unit 1'],
    'a card that comes from a review has no flag',
  )
})

test('what was written on a card since stands on three sides: what was looked into, what was fixed, and what concludes nothing', () => {
  const later = (minutes: number) => ({ ...cardOf(top, 1).record.provenance, at: `2026-10-12T10:${String(minutes)}:00.000Z` })

  flag(top, {
    text: 'Seen: the session is never closed.\nExpected: x.\nFound: y.\nChecked: z.\nDid: fixed in the task: closed it in `logout()`.',
    places: [],
  })
  note(top, 4, {
    text: 'Ran: the test with a token of one second:\n\n```text\n401 Unauthorized\n```\nRead: `src/auth/token.ts`.\nShows: the token is refused once it is a second old. It does not show which caller should refresh it.',
  })
  note(top, 4, { provenance: later(10), conclusion: null, text: 'To take up after the release.' })
  note(top, 4, {
    provenance: later(20),
    conclusion: 'fixed',
    text: 'The card was right.\nChanged: `refresh()` is called before a request.\nVerified: ran the suite: 42 passed.\nLeft: nothing.',
  })
  note(top, 4, { provenance: later(30), conclusion: 'unsure', text: 'Ran: the suite again.\nRead: nothing.\nShows: nothing new.' })

  const card = cardOf(top, 4)
  const sides = new CardSides(card)
  const sheet = new CardSheet(card, plain, 64)
  const signed = /^▍ claude {2}(. \w+) {2}\d{4}-\d\d-\d\d \d\d:\d\d(.*)$/
  const heads = (tab: SheetTab) => sheet.lines(tab).flatMap((line) => (signed.exec(line) ?? []).slice(1, 2))

  assert.deepEqual(
    CardSides.TABS.map((tab) => sides.countOf(tab)),
    [0, 0, 2, 2, 1],
    'a flag that says its author fixed the thing counts as the first fix',
  )
  assert.deepEqual(sheet.lines('investigation').slice(1, 12), [
    '',
    'Ran       the test with a token of one second:',
    '',
    '            │ 401 Unauthorized',
    '',
    'Read      src/auth/token.ts.',
    '',
    'Shows     the token is refused once it is a second old. It does',
    '          not show which caller should refresh it.',
    '',
    '',
  ])
  assert.deepEqual(heads('investigation'), ['✓ confirmed', '? unsure'], 'each side is in the order it was written')
  assert.deepEqual(sheet.lines('investigation').slice(-3), ['Ran       the suite again.', 'Read      nothing.', 'Shows     nothing new.'])

  const fix = sheet.lines('fix')

  assert.match(fix[0] ?? '', /^▍ claude {2}● fixed {2}\d{4}-\d\d-\d\d \d\d:\d\d {2}in its flag$/)
  assert.deepEqual(fix.slice(1, 5), ['', 'closed it in logout().', '', ''])
  assert.deepEqual(
    fix.slice(6),
    [
      '',
      'The card was right.',
      '',
      'Changed   refresh() is called before a request.',
      'Verified  ran the suite: 42 passed.',
      'Left      nothing.',
    ],
    'what a report says before its first field stands above them',
  )
  assert.deepEqual(sheet.lines('notes').slice(1), ['', 'To take up after the release.'])
  assert.match(sheet.lines('notes')[0] ?? '', /^▍ claude {2}\d{4}/, 'a note that concludes nothing says who and when')
})

test('the paint of the interface gives each style the colour of the theme, and gives the line back to the ivory afterwards', () => {
  const paint = new ThemePaint()

  assert.equal(paint.dim('later'), `${ink(THEME.muted)}later${ink(THEME.ivory)}`)
  assert.equal(paint.magenta('return'), `${ink(THEME.gold)}return${ink(THEME.ivory)}`)
  assert.equal(paint.code('refresh()'), `${ground(THEME.raised)}refresh()${ground(THEME.panel)}`, 'a word of code stands on a chip')
  assert.equal(
    new ThemePaint(THEME.ground).code('x'),
    `${ground(THEME.raised)}x${ground(THEME.ground)}`,
    'and gives back the ground of its pane',
  )
  assert.deepEqual(
    [paint.green(''), paint.grounds, new Paint(true).grounds, new Paint(true).code('x')],
    ['', true, false, new Paint(true).cyan('x')],
  )
  assert.deepEqual(new TerminalMarkdown(paint, 30).lines('Call `refresh()` first.'), [
    `Call ${ground(THEME.raised)}refresh()${ground(THEME.panel)} first.`,
  ])
})

test('where the paint has grounds, code stands on one as wide as the page, and the line that matters on a lighter one', () => {
  const paint = new ThemePaint()
  const measure = new WrappedLines(30)
  const code = new DrawnCode(paint, 30)
  const block = code.block('  if (x) {\n    return 1\n  }', 'js')
  const excerpt = code.excerpt(
    [
      { number: 9, text: 'const a = 1' },
      { number: 10, text: 'return a' },
    ],
    'js',
    10,
  )
  const plainly = (line: string): string => line.replaceAll(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '')

  assert.deepEqual(block.map(plainly), [' '.repeat(30), ' if (x) {'.padEnd(30), '   return 1'.padEnd(30), ' }'.padEnd(30), ' '.repeat(30)])
  assert.ok(
    block.every((line) => line.startsWith(ground(THEME.ground)) && line.endsWith(ground(THEME.panel)) && measure.visible(line) === 30),
  )
  assert.deepEqual(excerpt.map(plainly), [' '.repeat(30), '    9  const a = 1'.padEnd(30), ' ▸ 10  return a'.padEnd(30), ' '.repeat(30)])
  assert.ok(excerpt[2]?.startsWith(ground(THEME.raised)), 'the line that was flagged stands out')
  assert.ok(excerpt[1]?.startsWith(ground(THEME.ground)))
})
