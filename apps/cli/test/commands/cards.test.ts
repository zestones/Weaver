import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import { cardOf, contextOf, finding, flag, inRegistry, write } from '../fixtures/cards.ts'
import { makeProject, weaver } from '../fixtures/project.ts'

const HINT = 'Read one with weaver cards <number>, and close it with weaver close <number> fixed|wontfix|issue [reason].'
const USAGE = [
  'Usage: weaver cards [<number>] [--all] [--file <path>] [--label <family:value>]',
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
    '#3 closed (wontfix) | the cache is never emptied.',
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

test('words that cards does not know are answered with how it is written', async () => {
  assert.deepEqual(await weaver(top, ['cards', '--closed']), { status: 2, lines: USAGE })
  assert.deepEqual(await weaver(top, ['cards', '--file']), { status: 2, lines: USAGE })
  assert.deepEqual(await weaver(top, ['cards', 'reopened', '1']), { status: 2, lines: USAGE })
})
