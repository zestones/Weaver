import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import { cardOf, contextOf, finding, flag, inRegistry, write } from '../fixtures/cards.ts'
import { makeProject, weaver } from '../fixtures/project.ts'

const HINT = 'Read one with weaver cards <number>, and close it with weaver close <number> fixed|wontfix|issue [reason].'
const USAGE = 'weaver cards [<number>] [--all] [--file <path>] [--label <family:value>]'
const OTHER_FLAG = [
  'Seen: the cache is never emptied.',
  'Expected: an entry leaves the cache when its session ends.',
  'Found: reading the session store.',
  'Checked: unknown.',
  'Did: worked around.',
].join('\n')
const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-cards-'))
let top: string
let counter = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  top = makeProject(join(scratch, `project-${String(counter)}`))
})

test('an empty list says that nothing waits, and a command that only reads creates no registry', () => {
  assert.deepEqual(weaver(top, ['cards']), { status: 0, lines: ['Nothing waits for you.'] })
  assert.deepEqual(weaver(top, ['cards', '--all']), { status: 0, lines: ['No card matches.'] })
  assert.deepEqual(weaver(top, ['cards', '3']), { status: 1, lines: ['weaver: no card has the number 3'] })
  assert.equal(
    weaver(top, ['doctor']).lines.some((line) => line.includes('registry')),
    false,
  )
  assert.equal(existsSync(join(top, '.git/weaver')), false)
})

test('cards lists the cards that wait, one line each, newest first; --all adds the others', () => {
  flag(top)
  finding(top)
  flag(top, { text: OTHER_FLAG, places: [] })
  flag(top, { text: `${OTHER_FLAG} Twice.`, places: [{ file: 'src/cache.ts', line: null }] })
  inRegistry(top, (registry) => {
    registry.closeCard(3, 'wontfix', 'the cache lives as long as the process')
    registry.merge(4, 1, 'the same cache')
  })

  assert.deepEqual(weaver(top, ['cards']), {
    status: 0,
    lines: [
      '2 card(s) wait for you:',
      '  #2 open  src/api/user.ts:7  The response is cast to User without being parsed.',
      '  #1 raw  src/auth/token.ts:42  no call of refresh() exists under src/.',
      HINT,
    ],
  })
  assert.deepEqual(weaver(top, ['cards', '--all']), {
    status: 0,
    lines: [
      '4 card(s):',
      '  #4 merged into #1  src/cache.ts  the cache is never emptied.',
      '  #3 closed (wontfix)  the cache is never emptied.',
      '  #2 open  src/api/user.ts:7  The response is cast to User without being parsed.',
      '  #1 raw  src/auth/token.ts:42  no call of refresh() exists under src/.',
      HINT,
    ],
  })
})

test('the list is narrowed to a file, named from where the owner stands, and to a label', () => {
  flag(top)
  finding(top)
  write(top, 1)
  mkdirSync(join(top, 'src/api'), { recursive: true })

  const onFile = ['1 card(s) wait for you:', '  #2 open  src/api/user.ts:7  The response is cast to User without being parsed.', HINT]

  assert.deepEqual(weaver(top, ['cards', '--file', 'src/api/user.ts']).lines, onFile)
  assert.deepEqual(weaver(join(top, 'src/api'), ['cards', '--file', 'user.ts']).lines, onFile)
  assert.deepEqual(weaver(top, ['cards', '--label', 'area:auth']).lines, [
    '1 card(s) wait for you:',
    '  #1 open  src/auth/token.ts:42  Nothing refreshes the token',
    HINT,
  ])
  assert.deepEqual(weaver(top, ['cards', '--label', 'area:api', '--file', 'src/auth/token.ts']).lines, ['No card matches.'])
})

test('a card that waits and points at a line that no longer reads as it did says so on its line', () => {
  mkdirSync(join(top, 'src/api'), { recursive: true })
  writeFileSync(join(top, 'src/token.ts'), 'export function getToken() {\n  return cached\n}\n')
  writeFileSync(join(top, 'src/api/user.ts'), 'const user = raw as User\n')
  flag(top, { places: [{ file: 'src/token.ts', line: 2 }], context: [contextOf('src/token.ts', 2, '  return cached')] })
  finding(top, { quote: 'const user = raw as User' }, { places: [{ file: 'src/api/user.ts', line: 1 }] })
  inRegistry(top, (registry) => registry.closeCard(2, 'fixed', null))
  finding(top, { review: '3f9a2c1/F2', quote: 'const user = raw as User' }, { places: [{ file: 'src/api/user.ts', line: 1 }] })

  assert.deepEqual(weaver(top, ['cards']).lines.slice(1, 3), [
    '  #3 open  src/api/user.ts:1  The response is cast to User without being parsed.',
    '  #1 raw  src/token.ts:2  no call of refresh() exists under src/.',
  ])

  writeFileSync(join(top, 'src/token.ts'), '// The token of the session.\nexport function getToken() {\n  return refreshed()\n}\n')
  rmSync(join(top, 'src/api/user.ts'))

  assert.deepEqual(weaver(top, ['cards', '--all']).lines.slice(1, 4), [
    '  #3 open  src/api/user.ts:1  The response is cast to User without being parsed.  (changed since: src/api/user.ts:1)',
    '  #2 closed (fixed)  src/api/user.ts:1  The response is cast to User without being parsed.',
    '  #1 raw  src/token.ts:2  no call of refresh() exists under src/.  (changed since: src/token.ts:2)',
  ])
  assert.equal(cardOf(top, 1).state, 'raw', 'a hint closes nothing')
})

test('a number prints the card as Markdown', () => {
  flag(top)
  write(top, 1)

  const { status, lines } = weaver(top, ['cards', '1'])

  assert.equal(status, 0)
  assert.equal(lines.join('\n'), cardOf(top, 1).markdown())
  assert.match(
    lines.join('\n'),
    /^# Nothing refreshes the token\n\n- Card: #1\n[^]*\n## Observation\n[^]*\n## Flag\n\n```text\nSeen: no call of refresh\(\)/,
  )
  assert.deepEqual(weaver(top, ['cards', '7']), { status: 1, lines: ['weaver: no card has the number 7'] })
})

test('words that cards does not know are answered with how it is written', () => {
  assert.deepEqual(weaver(top, ['cards', '--closed']), { status: 2, lines: [USAGE] })
  assert.deepEqual(weaver(top, ['cards', '--file']), { status: 2, lines: [USAGE] })
  assert.deepEqual(weaver(top, ['cards', 'reopened', '1']), { status: 2, lines: [USAGE] })
})
