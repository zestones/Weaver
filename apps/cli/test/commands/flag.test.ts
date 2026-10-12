import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlagText } from '@weaver/memory'
import { afterAll, beforeEach, test } from 'vitest'
import { cardOf, FLAG_BODY } from '../fixtures/cards.ts'
import { makeProject, weaver } from '../fixtures/project.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-flag-'))
let top: string
let counter = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  top = makeProject(join(scratch, `project-${String(counter)}`))
  mkdirSync(join(top, 'src/auth'), { recursive: true })
  writeFileSync(join(top, 'src/auth/token.ts'), 'export function getToken() {\n  return cached\n}\n')
})

test('the owner flags from a terminal: the places and the five fields are recorded as theirs, with the lines as they were', async () => {
  assert.deepEqual(await weaver(top, ['flag', 'src/auth/token.ts:2', 'src/auth'], { input: FLAG_BODY }), {
    status: 0,
    lines: ['✓ Flag #1 recorded.'],
  })

  const { origin, state, places, provenance, flag } = cardOf(top, 1).record
  const { author, role, session, subagent, unit, requests } = provenance

  assert.deepEqual([origin, state], ['owner', 'raw'])
  assert.deepEqual(places, [
    { file: 'src/auth/token.ts', line: 2 },
    { file: 'src/auth', line: null },
  ])
  assert.deepEqual([author, role, session, subagent, unit, requests], ['owner', 'owner', null, null, null, []])
  assert.equal(flag?.text, FLAG_BODY)
  assert.deepEqual([flag?.fields.seen, flag?.fields.did], ['no call of refresh() exists under src/.', 'left'])
  assert.equal(flag?.context[0]?.lineText, '  return cached')
  assert.deepEqual((await weaver(top, ['cards'])).lines.slice(2, 4), [
    '  #1  raw  no call of refresh() exists under src/.',
    '           src/auth/token.ts:2 +1',
  ])
})

test('a place is named from where the owner stands, and a flag may have none', async () => {
  assert.deepEqual((await weaver(join(top, 'src/auth'), ['flag', 'token.ts:1'], { input: FLAG_BODY })).lines, ['✓ Flag #1 recorded.'])
  assert.deepEqual((await weaver(top, ['flag'], { input: FLAG_BODY })).lines, ['✓ Flag #2 recorded.'])
  assert.deepEqual(cardOf(top, 1).places, [{ file: 'src/auth/token.ts', line: 1 }])
  assert.deepEqual(cardOf(top, 2).places, [])
})

test('a flag that cannot be used is not recorded: the owner reads what is missing, with the format', async () => {
  const body = 'Seen: no call of refresh() exists.\nChecked: unknown.\nDid: postponed.'
  const problems = new FlagText(body).problems()
  const empty = await weaver(top, ['flag'], { input: '\n' })

  assert.equal(problems.length, 3)
  assert.match(problems[0] ?? '', /^`Expected:` is missing: /)
  assert.deepEqual(await weaver(top, ['flag', 'src/auth/token.ts:2'], { input: body }), {
    status: 1,
    lines: ['X The flag was not recorded:', ...problems.map((problem) => `  ${problem}`), '', ...FlagText.FORMAT.split('\n')],
  })
  assert.equal(empty.status, 1)
  assert.deepEqual([empty.lines[0], empty.lines.at(-1)], ['X The flag was not recorded:', FlagText.FORMAT.split('\n').at(-1)])
  assert.equal(empty.lines.slice(-FlagText.FORMAT.split('\n').length).join('\n'), FlagText.FORMAT, 'the form is given as it is typed')
  assert.match(empty.lines[1] ?? '', /^ {2}\S/)
  assert.deepEqual((await weaver(top, ['cards'])).lines, ['Nothing waits for you.'])
})

test('run under an agent, flag records nothing: the hook answers an agent, so reading this means it is not wired', async () => {
  assert.deepEqual(await weaver(top, ['flag', 'src/auth/token.ts:2'], { input: FLAG_BODY, under: 'codex' }), {
    status: 1,
    lines: [
      "X Nothing was recorded. The flag of an agent is recorded by Weaver's hook, which answers in place of this command: reading this means that the project is not wired for codex. weaver doctor says what is missing.",
    ],
  })
  assert.equal(existsSync(join(top, '.git/weaver')), false)
})
