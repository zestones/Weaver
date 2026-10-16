import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { failuresOf, makeProject, weaver } from '../fixtures/project.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-help-'))
const top = makeProject(join(scratch, 'project'))
// The names a section of the help lists, in their order.
const listedUnder = (lines: readonly string[], heading: string): string[] => {
  const start = lines.indexOf(heading)
  const end = lines.indexOf('', start)

  return lines.slice(start + 1, end === -1 ? undefined : end).map((line) => line.trim().split(/ {2,}/)[0] ?? '')
}

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

test('without a command, weaver says what it is, how it is typed and what it can do, by what each command is for', async () => {
  const { status, lines } = await weaver(top, [])

  assert.equal(status, 0)
  assert.match(lines[0] ?? '', /^Weaver supervises the coding agents that work in a project/)
  assert.deepEqual(listedUnder(lines, 'USAGE'), ['weaver <command> [arguments]'])
  assert.deepEqual(listedUnder(lines, 'SET UP'), ['install', 'update', 'uninstall', 'doctor', 'version'])
  assert.deepEqual(listedUnder(lines, 'SUPERVISION'), ['maintenance', 'check', 'guide', 'stats'])
  assert.deepEqual(listedUnder(lines, 'CARDS'), [
    'cards',
    'ui',
    'flag',
    'note',
    'close',
    'cards reopen',
    'cards retitle',
    'cards label',
    'cards rewrite',
    'cards tie',
    'cards untie',
    'cards separate',
  ])
  assert.deepEqual(listedUnder(lines, 'FLAGS'), ['--help', '--version', '--no-color'])
  assert.ok(lines.includes('  install         Put Weaver on this project'), 'the names of a page are all as wide')
  assert.ok(lines.includes('  --no-color      Print without colour'))
  assert.ok(lines.includes('  $ weaver doctor'))
  assert.equal(lines.at(-1), '  Read the manual at https://github.com/zestones/Weaver')
})

test('help is asked for by its word or its flag, anywhere on the line, and an agent may ask too', async () => {
  const whole = await weaver(top, [])

  for (const words of [['help'], ['--help'], ['-h'], ['--no-color']]) assert.deepEqual(await weaver(top, words), whole, words.join(' '))

  const close = await weaver(top, ['help', 'close'])

  assert.deepEqual(close, {
    status: 0,
    lines: [
      'Close a card: it was fixed, it will not be, it is now an issue of its own, or what it says proved not to be true.',
      '',
      'USAGE',
      '  weaver close <number> fixed|wontfix|issue|invalid [reason]',
      '',
      'ARGUMENTS',
      '  <number>                     The number of the card, as weaver cards shows it',
      '  fixed|wontfix|issue|invalid  Why it closes: it was fixed, it will not be, it becomes an issue of its own, or what it says is not true',
      '  [reason]                     A few words kept with the card',
      '',
      'EXAMPLES',
      '  $ weaver close 12 fixed',
      '  $ weaver close 12 wontfix "the old behaviour is wanted"',
      '  $ weaver close 12 invalid',
      '',
      'This command decides or changes something: it is yours, and does not run under an agent.',
    ],
  })
  assert.deepEqual(await weaver(top, ['close', '--help']), close)
  assert.deepEqual(await weaver(top, ['close', '12', '-h', 'fixed']), close, 'the card is not closed: help was asked for')
  assert.deepEqual(await weaver(top, ['help', 'close'], { under: 'claude' }), close, 'reading how a command is used decides nothing')

  const stats = await weaver(top, ['stats', '--help'])
  const reopen = await weaver(top, ['help', 'cards', 'reopen'])

  assert.deepEqual(listedUnder(stats.lines, 'FLAGS'), ['--since <day>|<n>d', '--json'])
  assert.equal(stats.lines.includes('ARGUMENTS'), false, 'a section with nothing in it is not shown')
  assert.equal(stats.lines.at(-1), '  $ weaver stats --json', 'a command an agent may run says nothing of whose it is')
  assert.equal(reopen.lines[3], '  weaver cards reopen <number> [note]')
})

test('a command weaver does not have is an error, with the command that was probably meant', async () => {
  assert.deepEqual(await weaver(top, ['doctr']), {
    status: 2,
    lines: ['X weaver has no command named "doctr".', '  Did you mean weaver doctor?', '  Run weaver help for the commands it has.'],
  })
  assert.deepEqual(await weaver(top, ['frobnicate']), {
    status: 2,
    lines: ['X weaver has no command named "frobnicate".', '  Run weaver help for the commands it has.'],
  })
  assert.equal((await weaver(top, ['help', 'statz'])).lines[1], '  Did you mean weaver stats?')
  assert.equal((await failuresOf(top, ['doctr'])).length, 3, 'an error is not part of the answer: it goes to the error stream')
  assert.deepEqual(await failuresOf(top, ['help']), [])
})
