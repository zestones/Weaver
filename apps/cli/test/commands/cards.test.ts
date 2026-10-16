import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import { cardOf, contextOf, finding, flag, inRegistry, note, write } from '../fixtures/cards.ts'
import { makeProject, SETTINGS, weaver, writeConfig } from '../fixtures/project.ts'

const HINT = 'Read one with weaver cards <number>, and close it with weaver close <number> fixed|wontfix|issue|invalid [reason].'
const USAGE = [
  'Usage: weaver cards [<number>] [--all] [--closed [fixed|wontfix|issue|invalid]] [--file <path>] [--label <family:value>]... [--since <day>|<n>d] [--answered] [--search <words>] [--sort newest|level]',
  'Run weaver help cards for what each word means.',
]
const OTHER_FLAG = [
  'Seen: the cache is never emptied.',
  'Expected: an entry leaves the cache when its session ends.',
  'Found: reading the session store.',
  'Checked: unknown.',
  'Did: worked around.',
].join('\n')
const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-cards-'))
// What colours a line at a terminal, to read a drawn page as the words it shows.
const STYLES = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
// The cards of a list, each on one line: its number and how it stands, what it is about, then what is under it.
const cardsOf = (lines: readonly string[]): string[] => {
  const cards: string[][] = []

  for (const line of lines) {
    if (/^ {2}#\d/.test(line)) cards.push(line.trim().split(/ {2,}/))
    else if (line.startsWith('   ') && cards.length > 0) cards.at(-1)?.push(line.trim())
  }

  return cards.map(([number = '', standing = '', ...rest]) => [`${number} ${standing}`, ...rest].join(' | '))
}
let top: string
let counter = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  top = makeProject(join(scratch, `project-${String(counter)}`))
})

test('an empty list says that nothing waits, and a command that only reads creates no registry', async () => {
  assert.deepEqual(await weaver(top, ['cards']), { status: 0, lines: ['Nothing waits for you.'] })
  assert.deepEqual(await weaver(top, ['cards', '--all']), { status: 0, lines: ['No card matches.'] })
  assert.deepEqual(await weaver(top, ['cards', '3']), { status: 1, lines: ['X No card has the number 3'] })
  assert.equal(
    (await weaver(top, ['doctor'])).lines.some((line) => line.includes('registry')),
    false,
  )
  assert.equal(existsSync(join(top, '.git/weaver')), false)
})

test('cards lists the cards that wait, one line each, newest first; --all adds the others', async () => {
  flag(top)
  finding(top)
  flag(top, { text: OTHER_FLAG, places: [] })
  flag(top, { text: `${OTHER_FLAG} Twice.`, places: [{ file: 'src/cache.ts', line: null }] })
  inRegistry(top, (registry) => {
    registry.closeCard(3, 'wontfix', 'the cache lives as long as the process')
    registry.merge(4, 1, 'the same cache')
  })

  assert.deepEqual(await weaver(top, ['cards']), {
    status: 0,
    lines: [
      '2 cards wait for you',
      '',
      '  #2  open  The response is cast to User without being parsed.',
      '            src/api/user.ts:7',
      '',
      '  #1  raw   no call of refresh() exists under src/.',
      '            src/auth/token.ts:42',
      '',
      HINT,
    ],
  })
  const all = await weaver(top, ['cards', '--all'])

  assert.equal(all.lines[0], '4 cards')
  assert.deepEqual(cardsOf(all.lines), [
    '#4 merged into #1 | the cache is never emptied. | src/cache.ts',
    '#3 closed (wontfix) | the cache is never emptied. | reason: the cache lives as long as the process',
    '#2 open | The response is cast to User without being parsed. | src/api/user.ts:7',
    '#1 raw | no call of refresh() exists under src/. | src/auth/token.ts:42',
  ])
  assert.equal(all.lines.at(-1), HINT)
})

test('the list is narrowed to a file, named from where the owner stands, and to a label', async () => {
  flag(top)
  finding(top)
  write(top, 1)
  mkdirSync(join(top, 'src/api'), { recursive: true })

  const onFile = ['#2 open | The response is cast to User without being parsed. | src/api/user.ts:7']
  const narrowed = await weaver(top, ['cards', '--file', 'src/api/user.ts'])

  assert.equal(narrowed.lines[0], '1 card waits for you')
  assert.deepEqual(cardsOf(narrowed.lines), onFile)
  assert.deepEqual(cardsOf((await weaver(join(top, 'src/api'), ['cards', '--file', 'user.ts'])).lines), onFile)
  assert.deepEqual(cardsOf((await weaver(top, ['cards', '--label', 'area:auth'])).lines), [
    '#1 open | Nothing refreshes the token | src/auth/token.ts:42',
  ])
  assert.deepEqual((await weaver(top, ['cards', '--label', 'area:api', '--file', 'src/auth/token.ts'])).lines, ['No card matches.'])
})

test('the list is narrowed by several labels, by date and to what someone concluded on, and put in order by level', async () => {
  writeConfig(top, {
    settings: SETTINGS,
    labels: { level: { high: 'Breaks a function.', low: 'Changes nothing.' }, area: { api: 'The API.', auth: 'Who signs in.' } },
  })
  flag(top)
  write(top, 1, { labels: { level: ['low'], area: ['auth'] } })
  flag(top, { text: OTHER_FLAG, places: [] })
  write(top, 2, { title: 'The cache is never emptied', labels: { level: ['high'], area: ['api'] } })
  finding(top)
  note(top, 2)

  const listed = async (...words: string[]): Promise<string[]> => cardsOf((await weaver(top, ['cards', ...words])).lines)

  assert.deepEqual(await listed('--label', 'area:api', '--label', 'area:auth'), [
    '#2 open (confirmed) | The cache is never emptied',
    '#1 open | Nothing refreshes the token | src/auth/token.ts:42',
  ])
  assert.deepEqual(await listed('--label', 'area:api', '--label', 'area:auth', '--label', 'level:low'), [
    '#1 open | Nothing refreshes the token | src/auth/token.ts:42',
  ])
  assert.deepEqual(await listed('--answered'), ['#2 open (confirmed) | The cache is never emptied'])
  assert.deepEqual((await listed('--since', '2026-10-01')).length, 3)
  assert.deepEqual((await weaver(top, ['cards', '--since', '2999-01-01'])).lines, ['No card matches.'])
  assert.deepEqual(
    (await weaver(top, ['cards', '--sort', 'level'])).lines.filter((line) => line.startsWith('  #')),
    [
      '  #2  open (confirmed)  high  The cache is never emptied',
      '  #1  open              low   Nothing refreshes the token',
      '  #3  open              -     The response is cast to User without being parsed.',
    ],
  )
  assert.deepEqual(await listed('--sort', 'newest'), await listed())

  for (const words of [['--label', 'api'], ['--since', 'yesterday'], ['--sort', 'gravity'], ['--sort']]) {
    assert.deepEqual(await weaver(top, ['cards', ...words]), { status: 2, lines: USAGE }, words.join(' '))
  }
})

test('the closed cards are listed alone, all of them or those closed one way, each with why and the issue it became', async () => {
  flag(top)
  flag(top, { text: OTHER_FLAG, places: [] })
  finding(top)
  inRegistry(top, (registry) => {
    registry.closeCard(1, 'wontfix', 'the token\nlives an hour')
    registry.closeCard(2, 'issue', null, 'https://issues.example/42')
  })

  const closed = await weaver(top, ['cards', '--closed'])

  assert.equal(closed.lines[0], '2 cards')
  assert.deepEqual(cardsOf(closed.lines), [
    '#2 closed (issue) | the cache is never emptied. | issue: https://issues.example/42',
    '#1 closed (wontfix) | no call of refresh() exists under src/. | src/auth/token.ts:42 | reason: the token lives an hour',
  ])
  assert.deepEqual(cardsOf((await weaver(top, ['cards', '--closed', 'wontfix'])).lines), [
    '#1 closed (wontfix) | no call of refresh() exists under src/. | src/auth/token.ts:42 | reason: the token lives an hour',
  ])
  assert.deepEqual((await weaver(top, ['cards', '--closed', 'fixed'])).lines, ['No card matches.'])
  assert.deepEqual(
    cardsOf((await weaver(top, ['cards', '--closed', '--search', 'lives an HOUR'])).lines).map((line) => line.slice(0, 2)),
    ['#1'],
    'the reason a card was closed for is searched too',
  )
  assert.deepEqual(cardsOf((await weaver(top, ['cards', '--search', 'cast to user'])).lines), [
    '#3 open | The response is cast to User without being parsed. | src/api/user.ts:7',
  ])
  assert.deepEqual((await weaver(top, ['cards', '--search', 'nothing says this'])).lines, ['No card matches.'])
  assert.deepEqual(await weaver(top, ['cards', '--search']), { status: 2, lines: USAGE })
  assert.deepEqual(await weaver(top, ['cards', '--closed', 'sometime']), { status: 2, lines: USAGE })
})

test('a card that waits and points at a line that no longer reads as it did says so on its line', async () => {
  mkdirSync(join(top, 'src/api'), { recursive: true })
  writeFileSync(join(top, 'src/token.ts'), 'export function getToken() {\n  return cached\n}\n')
  writeFileSync(join(top, 'src/api/user.ts'), 'const user = raw as User\n')
  flag(top, { places: [{ file: 'src/token.ts', line: 2 }], context: [contextOf('src/token.ts', 2, '  return cached')] })
  finding(top, { quote: 'const user = raw as User' }, { places: [{ file: 'src/api/user.ts', line: 1 }] })
  inRegistry(top, (registry) => registry.closeCard(2, 'fixed', null))
  finding(top, { review: '3f9a2c1/F2', quote: 'const user = raw as User' }, { places: [{ file: 'src/api/user.ts', line: 1 }] })

  assert.deepEqual(cardsOf((await weaver(top, ['cards'])).lines), [
    '#3 open | The response is cast to User without being parsed. | src/api/user.ts:1',
    '#1 raw | no call of refresh() exists under src/. | src/token.ts:2',
  ])

  writeFileSync(join(top, 'src/token.ts'), '// The token of the session.\nexport function getToken() {\n  return refreshed()\n}\n')
  rmSync(join(top, 'src/api/user.ts'))

  assert.deepEqual(cardsOf((await weaver(top, ['cards', '--all'])).lines), [
    '#3 open | The response is cast to User without being parsed. | src/api/user.ts:1 | changed since: src/api/user.ts:1',
    '#2 closed (fixed) | The response is cast to User without being parsed. | src/api/user.ts:1',
    '#1 raw | no call of refresh() exists under src/. | src/token.ts:2 | changed since: src/token.ts:2',
  ])
  assert.equal(cardOf(top, 1).state, 'raw', 'a hint closes nothing')
})

test('a number prints the card as Markdown', async () => {
  flag(top)
  write(top, 1)

  const { status, lines } = await weaver(top, ['cards', '1'])

  assert.equal(status, 0)
  assert.equal(lines.join('\n'), cardOf(top, 1).markdown())
  assert.match(
    lines.join('\n'),
    /^# Nothing refreshes the token\n\n- Card: #1\n[^]*\n## Observation\n[^]*\n## Flag\n\n```text\nSeen: no call of refresh\(\)/,
  )
  assert.deepEqual(await weaver(top, ['cards', '7']), { status: 1, lines: ['X No card has the number 7'] })
})

test('at a terminal the card is drawn, and a program still reads it as Markdown', async () => {
  flag(top, { context: [contextOf('src/auth/token.ts', 42, '    return cached')] })
  write(top, 1)

  const read = await weaver(top, ['cards', '1'])
  const { status, lines } = await weaver(top, ['cards', '1'], { terminal: 80 })
  const page = lines.map((line) => line.replaceAll(STYLES, ''))

  assert.equal(status, 0)
  assert.equal(read.lines.join('\n'), cardOf(top, 1).markdown(), 'what is piped is the Markdown, to the letter')
  assert.deepEqual(page.slice(0, 2), ['', '  Nothing refreshes the token'], 'the page is set apart by a margin')
  assert.match(page[2] ?? '', /^ {2}#1 · open · flagged by claude · \d{4}-\d{2}-\d{2} \d{2}:\d{2} · type:bug, area:auth$/)
  assert.ok(page.includes(`  Observation ${'─'.repeat(64)}`), 'a part of the card opens under a rule that ends with the page')
  assert.ok(page.includes('    Seen      no call of refresh() exists under src/.'), 'the flag is drawn field by field')
  assert.ok(page.includes('  ▸ 42 │ return cached'), 'the line that was flagged is pointed at')
  assert.deepEqual(page.slice(-3), [
    '  Write on it with weaver note 1 [confirmed|refuted|unsure|fixed] <text>.',
    '  Close it with weaver close 1 fixed|wontfix|issue|invalid [reason].',
    '',
  ])
  assert.equal(lines[1], '  \u001B[1mNothing\u001B[22m \u001B[1mrefreshes\u001B[22m \u001B[1mthe\u001B[22m \u001B[1mtoken\u001B[22m')
})

test('an agent that reads a card is told how to write on it what it finds, and the owner is not', async () => {
  flag(top)
  flag(top, { text: OTHER_FLAG, places: [] })
  inRegistry(top, (registry) => registry.merge(2, 1, 'the same cache'))

  const card = cardOf(top, 1).markdown().split('\n')
  const read = await weaver(top, ['cards', '1'], { under: 'claude' })

  assert.deepEqual(read.lines.slice(0, card.length), card)
  assert.deepEqual(read.lines.slice(card.length), [
    '',
    '---',
    '',
    '[weaver] When your task settles this card or finds more on it, write it on the card with the commands below: what you looked into, then what you changed if you fixed it. Weaver answers in their place, as for a flag. The cards about the same files may share its cause: `weaver cards --file <path>`.',
    '',
    "weaver note 1 confirmed|refuted|unsure <<'EOF'",
    'Ran: what you ran, and what it showed.',
    'Read: what you read without running it.',
    'Shows: what this proves, and what it does not.',
    'EOF',
    '',
    "weaver note 1 fixed <<'EOF'",
    'Changed: what you changed, and where.',
    'Verified: how you checked it afterwards, and what that showed.',
    'Left: what is left to do.',
    'EOF',
    '',
    'The first reports an investigation: confirmed when what the card says is true, refuted when it is not, unsure when you could not tell. The second reports a fix. When you looked into the card and then fixed it, write both, in that order. Each keyword starts a line. A field may span lines, and may say that there is nothing to say. Without a word, a note concludes nothing and is free text.',
  ])
  assert.equal(
    (await weaver(top, ['cards'], { under: 'claude' })).lines.at(-1),
    'Read one with weaver cards <number>, and write on it with weaver note <number>: closing it is the owner’s.',
    'an agent is not sent to a command of the owner',
  )
  assert.equal((await weaver(top, ['cards', '1'])).lines.join('\n'), card.join('\n'), 'the owner reads the card alone')
  assert.equal(
    (await weaver(top, ['cards', '2'], { under: 'claude' })).lines.join('\n'),
    cardOf(top, 2).markdown(),
    'a card that became another is not written on',
  )
})

test('words that cards does not know are answered with how it is written', async () => {
  assert.deepEqual(await weaver(top, ['cards', '--waiting']), { status: 2, lines: USAGE })
  assert.deepEqual(await weaver(top, ['cards', '--file']), { status: 2, lines: USAGE })
  assert.deepEqual(await weaver(top, ['cards', 'reopened', '1']), { status: 2, lines: USAGE })
})
