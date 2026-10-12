import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Loop } from '@weaver/engine'
import { afterAll, beforeEach, test } from 'vitest'
import { makeProject, SETTINGS, weaver, writeConfig } from '../fixtures/project.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-maintenance-'))
const FIRST = '3f2a91c0-5b7e-4c1d-9a44-0d6f2e8b1c73'
const SECOND = 'b81e77d2-0c3a-4f6e-8d15-7a9b2c4e6f80'
const USAGE = ['Usage: weaver maintenance [on|off] [<session>]', 'Run weaver help maintenance for what each word means.']
const MOMENT = String.raw`\d{4}-\d{2}-\d{2} \d{2}:\d{2}`
// The sessions a list shows, each as its words: its name, its runtime, when it was last seen, since when it is in
// maintenance, what it was last asked.
const sessionsOf = (lines: readonly string[]): string[][] =>
  lines
    .slice(lines.findIndex((line) => line.startsWith('  session')) + 1)
    .flatMap((line) => (line.startsWith('  ') ? [line.trim().split(/ {2,}/)] : []))
let top: string
let counter = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  top = makeProject(join(scratch, `project-${String(counter)}`))
  writeConfig(top, {
    settings: SETTINGS,
    guards: { tools: { statement: 'The checks are the owner’s.', writes: ['tools/**'] } },
  })
})

async function hook(event: string, session: string, payload: Record<string, unknown>, agent = 'claude'): Promise<string> {
  const answer = await new Loop().handle(event, [`--agent=${agent}`], JSON.stringify({ session_id: session, cwd: top, ...payload }))

  return answer.print()
}

const asks = (session: string, prompt: string, agent?: string): Promise<string> => hook('UserPromptSubmit', session, { prompt }, agent)
const writes = (session: string, path: string): Promise<string> =>
  hook('PreToolUse', session, { tool_name: 'Write', tool_input: { file_path: join(top, path), content: '' }, tool_use_id: path })

function lastSeen(session: string, minutesAgo: number): void {
  const at = new Date(Date.now() - minutesAgo * 60_000)

  utimesSync(join(top, '.git/weaver/sessions', session, 'state.json'), at, at)
}

test('the one session at work is put in maintenance: its guards let its calls through until the owner turns it off', async () => {
  await asks(FIRST, 'loosen the check\nand say what you changed')

  assert.match(
    await writes(FIRST, 'tools/markers.mjs'),
    /Only the owner lifts the guards, for this session: `weaver maintenance on 3f2a91c0`\./,
  )

  const on = await weaver(top, ['maintenance', 'on'])

  assert.equal(on.status, 0)
  assert.match(on.lines[0] ?? '', new RegExp(`^✓ Maintenance is on for the session 3f2a91c0 \\(claude, last seen ${MOMENT}\\)\\.$`))
  assert.deepEqual(on.lines.slice(1), [
    "  The guards of the project and the one on Weaver's configuration let its calls through.",
    '  Its work is still checked, and each call a guard would have refused is listed for you when the task ends.',
    "  Weaver's state, the hook settings of the agents and your own commands stay refused.",
    '',
    'Nothing turns it off but you: weaver maintenance off 3f2a91c0',
  ])
  assert.equal(await writes(FIRST, 'tools/markers.mjs'), '')
  assert.equal(await writes(FIRST, '.weaver/project/guards.json'), '')
  assert.match(await writes(FIRST, '.claude/settings.json'), /weaver:protected/)

  const again = await weaver(top, ['maintenance', 'on'])
  const standing = await weaver(top, ['maintenance'])
  const doctor = await weaver(top, ['doctor'])

  assert.equal(again.status, 0)
  assert.match(again.lines.join('\n'), new RegExp(`^- The session 3f2a91c0 was already in maintenance, since ${MOMENT}\\.$`))
  assert.equal(standing.status, 0)
  assert.equal(standing.lines[0], '1 session in maintenance')
  assert.match(standing.lines[2] ?? '', /^ {2}session {3}runtime {2}last seen {9}in maintenance since {2}last asked$/)
  assert.match(standing.lines[3] ?? '', new RegExp(`^  3f2a91c0  claude   ${MOMENT}  ${MOMENT} {6}loosen the check$`))
  assert.equal(standing.lines.at(-1), 'Put the guards back with weaver maintenance off [<session>].')
  assert.deepEqual(doctor.lines.slice(doctor.lines.indexOf('Sessions'), doctor.lines.indexOf('Sessions') + 2), [
    'Sessions',
    '  - The session 3f2a91c0 (claude) is in maintenance: the guards of the project let its calls through. weaver maintenance off 3f2a91c0 puts them back.',
  ])

  assert.deepEqual(await weaver(top, ['maintenance', 'off']), {
    status: 0,
    lines: ['✓ Maintenance is off for the session 3f2a91c0: the guards refuse its calls again.'],
  })
  assert.match(await writes(FIRST, 'tools/markers.mjs'), /^\{.*\[weaver tools\] Writing tools\/markers\.mjs is refused/)
  assert.deepEqual(await weaver(top, ['maintenance', 'off']), { status: 0, lines: ['No session is in maintenance.'] })
  assert.deepEqual(await weaver(top, ['maintenance']), { status: 0, lines: ['No session is in maintenance.'] })
  assert.equal((await weaver(top, ['doctor'])).lines.includes('Sessions'), false, 'nothing is said of sessions when none is in maintenance')
})

test('a session is never guessed among several: they are listed, and one is named by the first characters of its id', async () => {
  await asks(FIRST, 'add the guard')
  await asks(SECOND, 'fix the failing test', 'codex')
  lastSeen(FIRST, 5)

  const guessed = await weaver(top, ['maintenance', 'on'])

  assert.equal(guessed.status, 1)
  assert.deepEqual(guessed.lines.slice(0, 2), [
    'X 2 sessions worked here in the last 60 minutes.',
    '  Name the one to put in maintenance, by the first characters of its id.',
  ])
  assert.deepEqual(
    sessionsOf(guessed.lines).map(([name, runtime, , since, asked]) => [name, runtime, since, asked]),
    [
      ['b81e77d2', 'codex', '-', 'fix the failing test'],
      ['3f2a91c0', 'claude', '-', 'add the guard'],
    ],
  )
  assert.equal((await writes(SECOND, 'tools/markers.mjs')) === '', false, 'nothing was lifted')

  const named = await weaver(top, ['maintenance', 'on', 'b8'])
  const unknown = await weaver(top, ['maintenance', 'on', 'zz'])

  assert.equal(named.status, 0)
  assert.match(named.lines[0] ?? '', /^✓ Maintenance is on for the session b81e77d2 \(codex, /)
  assert.equal(await writes(SECOND, 'tools/markers.mjs'), '')
  assert.match(await writes(FIRST, 'tools/markers.mjs'), /is refused/, 'the other session keeps its guards')
  assert.equal(unknown.status, 1)
  assert.equal(unknown.lines[0], 'X No session starts with "zz".')
  assert.equal(sessionsOf(unknown.lines).length, 2)
  assert.match(sessionsOf(unknown.lines)[0]?.[3] ?? '', new RegExp(`^${MOMENT}$`), 'the session in maintenance says since when')

  assert.deepEqual(await weaver(top, ['maintenance', 'off', '3f']), {
    status: 0,
    lines: ['- The session 3f2a91c0 was not in maintenance.'],
  })
  assert.equal(await writes(SECOND, 'tools/markers.mjs'), '', 'turning it off for one session leaves the other in it')
  assert.deepEqual(await weaver(top, ['maintenance', 'off', SECOND]), {
    status: 0,
    lines: ['✓ Maintenance is off for the session b81e77d2: the guards refuse its calls again.'],
  })
})

test('sessions whose ids start alike are told apart by more of their characters', async () => {
  const twin = `${FIRST.slice(0, 12)}-0000-4000-8000-000000000000`

  await asks(FIRST, 'one')
  await asks(twin, 'another')

  const both = await weaver(top, ['maintenance', 'on', '3f2a91c0'])

  assert.equal(both.status, 1)
  assert.deepEqual(both.lines.slice(0, 2), ['X 2 sessions start with "3f2a91c0".', '  Give more of its characters.'])
  assert.deepEqual(
    sessionsOf(both.lines)
      .map(([name]) => name)
      .sort(),
    ['3f2a91c0-5b7-', '3f2a91c0-5b7e'],
  )
  assert.equal((await weaver(top, ['maintenance', 'on', '3f2a91c0-5b7e'])).status, 0)
})

test('with no session at work, none is put in maintenance unless it is named', async () => {
  assert.deepEqual(await weaver(top, ['maintenance', 'on']), {
    status: 1,
    lines: ['X No session is known here.', '  A session is known from its first request on.'],
  })

  await asks(FIRST, 'add the guard')
  lastSeen(FIRST, 120)

  const idle = await weaver(top, ['maintenance', 'on'])

  assert.equal(idle.status, 1)
  assert.deepEqual(idle.lines.slice(0, 2), [
    'X No session worked here in the last 60 minutes.',
    '  Name the one to put in maintenance, by the first characters of its id.',
  ])
  assert.deepEqual(
    sessionsOf(idle.lines).map(([name, runtime]) => [name, runtime]),
    [['3f2a91c0', 'claude']],
  )
  assert.equal((await weaver(top, ['maintenance', 'on', '3f2a'])).status, 0)
})

test('maintenance takes on or off and one session at most, and is the owner’s', async () => {
  await asks(FIRST, 'add the guard')

  assert.deepEqual(await weaver(top, ['maintenance', 'sometimes']), { status: 2, lines: USAGE })
  assert.deepEqual(await weaver(top, ['maintenance', 'on', '3f', 'b8']), { status: 2, lines: USAGE })
  assert.deepEqual(await weaver(top, ['maintenance', 'on'], { under: 'claude' }), {
    status: 1,
    lines: [
      "X weaver maintenance is the owner's: it decides or changes something, so it runs from a terminal of their own, and not under claude.",
    ],
  })
  assert.match(await writes(FIRST, 'tools/markers.mjs'), /is refused/)
})
