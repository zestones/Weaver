import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import type { Declaration } from '../../src/declaration/content/declaration.ts'
import { Session } from '../../src/unit-of-work/session/session.ts'
import { SAMPLE_REPO, makeRepo } from '../fixtures/repo.ts'
import {
  A_FILE,
  agentWrites,
  bashCall,
  declaration,
  eventsOf,
  FAILING,
  finishWith,
  PASSING,
  prompt,
  refusalOf,
  stateOf,
  stubChecks,
} from '../fixtures/session.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-maintenance-'))
const GUARDS = { tools: { statement: 'The checks and the history are the owner’s.', writes: ['tools/**'], runs: ['git commit'] } }
const REMINDER = '[weaver] This task is over and the session is still in maintenance: `weaver maintenance off s` puts the guards back.'
let session: Session
let project: Declaration
let counter = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  session = new Session(makeRepo(join(scratch, `repo-${String(counter)}`), SAMPLE_REPO), 's', 'claude')
  project = declaration({ guards: GUARDS })
})

const writing = (path: string): Record<string, unknown> => ({
  tool_name: 'Write',
  tool_input: { file_path: join(session.repo.top, path), content: '' },
})
const refused = (tool: Record<string, unknown>): string | null => refusalOf(session, tool, project)
const reportOf = (text: string): string => readFileSync(/Report: (\S+)/.exec(text)?.[1] ?? '', 'utf8')
const briefingOf = (text: string): string => {
  const output = prompt(session, text, project).hookSpecificOutput

  return output !== undefined && 'additionalContext' in output ? output.additionalContext : ''
}

test('a guard that refuses names the command that lifts it, which only the owner runs', () => {
  prompt(session, 'loosen the check', project)

  assert.equal(
    refused(writing('tools/markers.mjs')),
    '[weaver tools] Writing tools/markers.mjs is refused. The checks and the history are the owner’s. Only the owner lifts the guards, for this session: `weaver maintenance on s`.',
  )
  assert.match(
    refused(bashCall('weaver maintenance on s')) ?? '',
    /^\[weaver weaver:owner-command\] Running `weaver maintenance` is refused\./,
  )
  assert.doesNotMatch(refused(bashCall('weaver maintenance on s')) ?? '', /Only the owner lifts/, 'nothing lifts this one')
  assert.doesNotMatch(refused(writing('.claude/settings.json')) ?? '', /Only the owner lifts/)
  assert.deepEqual(eventsOf(session, 'lift'), [])
})

test('in maintenance, what the guards of the project refuse goes through and waits for the owner, who is reminded to close it', async () => {
  prompt(session, 'loosen the check and commit', project)

  assert.equal(session.maintain(true), true)
  assert.equal(session.maintain(true), false, 'it was already on')
  assert.equal(refused(writing('tools/markers.mjs')), null)
  assert.equal(refused(bashCall('git commit -am done')), null)
  assert.equal(refused(writing('.weaver/project/guards.json')), null)
  assert.equal(refused(writing('tools/markers.mjs')), null, 'the same call again')
  assert.deepEqual(
    eventsOf(session, 'lift').map(({ tool, guard, what }) => [tool, guard, what]),
    [
      ['Write', 'tools', 'Writing tools/markers.mjs'],
      ['Bash', 'tools', 'Running `git commit`'],
      ['Write', 'weaver:declaration', 'Writing .weaver/project/guards.json'],
      ['Write', 'tools', 'Writing tools/markers.mjs'],
    ],
  )
  assert.deepEqual(eventsOf(session, 'refuse'), [])
  assert.equal(stateOf(session)?.unit.lifted.length, 3, 'the same call made twice is one thing to look at')

  agentWrites(session, { [A_FILE]: 'export const a = 2\n' })

  const { systemMessage = '', decision } = await finishWith(session, stubChecks([PASSING]), project)

  assert.equal(decision, undefined)
  assert.match(systemMessage, /^\[weaver\] 1 check passed on 1 changed file\. 3 items to validate\. Report: \S+ /)
  assert.equal(systemMessage.endsWith(REMINDER), true, systemMessage)
  assert.match(
    reportOf(systemMessage),
    /## To validate\n\n- tools\/markers\.mjs\n {2}- weaver:maintenance, written, which the guard tools refuses\n- \.weaver\/project\/guards\.json\n {2}- weaver:maintenance, written, which the guard weaver:declaration refuses\n- weaver:maintenance, tools: Running `git commit` went through in maintenance, which this guard refuses\n/,
  )
  assert.deepEqual(stateOf(session)?.unit.lifted, [], 'the next unit of work starts with none')
  assert.notEqual(session.maintenance, null, 'nothing closes maintenance but the owner')
})

test('maintenance lifts nothing an agent could unplug Weaver with, nor the commands of the owner', () => {
  session.maintain(true)

  assert.match(refused(writing('.claude/settings.json')) ?? '', /^\[weaver weaver:protected\] Writing \.claude\/settings\.json is refused/)
  assert.match(refused(writing('.codex/hooks.json')) ?? '', /weaver:protected/)
  assert.match(refused(bashCall('echo {} > .git/weaver/sessions/s/state.json')) ?? '', /weaver:protected/)
  assert.match(refused(bashCall('weaver maintenance on other')) ?? '', /weaver:owner-command/)
  assert.match(refused(bashCall('weaver uninstall')) ?? '', /weaver:owner-command/)
  assert.match(
    refused(bashCall('echo {} > tools/markers.mjs && echo {} > .claude/settings.json')) ?? '',
    /weaver:protected/,
    'a call that also does what maintenance lifts',
  )
  assert.deepEqual(eventsOf(session, 'lift'), [])
  assert.equal(eventsOf(session, 'refuse').length, 6)
})

test('what went through with no file changed still reaches the owner: the task ends with a report', async () => {
  prompt(session, 'commit what is there', project)
  session.maintain(true)
  refused(bashCall('git commit -am done'))

  const { systemMessage = '' } = await finishWith(session, stubChecks([PASSING]), project)

  assert.match(systemMessage, /^\[weaver\] No file changed in this turn\. 1 item to validate\. Report: \S+ /)
  assert.equal(systemMessage.endsWith(REMINDER), true)
  assert.match(reportOf(systemMessage), /- weaver:maintenance, tools: Running `git commit` went through in maintenance/)
  assert.deepEqual(
    eventsOf(session, 'settle').map(({ unit, files }) => [unit, files]),
    [[1, 0]],
  )
})

test('the owner is reminded when a task ends, whatever ends it, and never while it goes on', async () => {
  const strict = declaration({ guards: GUARDS, limits: { maxRefusals: 1 }, finish: { headings: ['Request', 'To validate'] } })

  session.maintain(true)
  prompt(session, 'what does the linter check?', strict)
  assert.deepEqual(
    await finishWith(session, stubChecks([PASSING]), strict, 'It checks the length of functions.'),
    {},
    'a turn that ends nothing',
  )

  assert.deepEqual(await finishWith(session, stubChecks([PASSING]), strict), { systemMessage: REMINDER }, 'a task that changed no file')

  prompt(session, 'change it', strict)
  agentWrites(session, { [A_FILE]: 'export const a = 2\n' })

  const refusal = await finishWith(session, stubChecks([FAILING]), strict)
  const given = await finishWith(session, stubChecks([FAILING]), strict)

  assert.equal(refusal.decision, 'block')
  assert.doesNotMatch(`${refusal.reason ?? ''}${refusal.systemMessage ?? ''}`, /still in maintenance/, 'the agent goes back to work')
  assert.match(given.systemMessage ?? '', /^\[weaver\] The checks still fail after 1 refusal; the agent may stop\. Report: \S+ /)
  assert.equal(given.systemMessage?.endsWith(REMINDER), true)
})

test('the agent is told of maintenance with each request while it is on, and the guards refuse again once it is off', async () => {
  assert.doesNotMatch(briefingOf('loosen the check'), /maintenance/)

  session.maintain(true)

  assert.match(briefingOf('go on'), /\n\n\[weaver\] The owner put this session in maintenance: the guards of the project/)
  assert.equal(refused(writing('tools/markers.mjs')), null)

  assert.equal(session.maintain(false), true)
  assert.equal(session.maintain(false), false, 'it was already off')
  assert.doesNotMatch(briefingOf('and now?'), /maintenance/)
  assert.match(refused(writing('tools/parse.mjs')) ?? '', /^\[weaver tools\] Writing tools\/parse\.mjs is refused/)
  assert.deepEqual(
    eventsOf(session, 'maintenance').map(({ on }) => on),
    [true, false],
  )

  agentWrites(session, { [A_FILE]: 'export const a = 2\n' })

  const { systemMessage = '' } = await finishWith(session, stubChecks([PASSING]), project)

  assert.match(systemMessage, /1 item to validate\./, 'what went through while it was on is still listed')
  assert.doesNotMatch(systemMessage, /still in maintenance/)
})
