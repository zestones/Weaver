import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test, vi } from 'vitest'
import { CheckOutcome } from '../../src/checks/results/check-outcome.ts'
import { EndOfTaskProgress } from '../../src/loop/progress/end-of-task-progress.ts'
import type { ProgressRecord } from '../../src/loop/progress/progress-record.ts'
import { Session } from '../../src/unit-of-work/session/session.ts'
import type { EventOf } from '../../src/unit-of-work/journal/journal-event.ts'
import { SAMPLE_REPO, makeRepo, writeFiles } from '../fixtures/repo.ts'
import {
  A_FILE,
  agentRuns,
  agentWrites,
  B_FILE,
  bashCall,
  declaration,
  eventsOf,
  FAILING,
  finishWith,
  LINT,
  PASSING,
  prompt,
  startTool,
  stateOf,
  stubChecks,
  unitFiles,
} from '../fixtures/session.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-finish-'))
let session: Session
let counter = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  session = new Session(makeRepo(join(scratch, `repo-${String(counter)}`), SAMPLE_REPO), 's', 'claude')
})

const checksOf = (): EventOf<'check'>[] => eventsOf(session, 'check')
const reportOf = (text: string): string => readFileSync(/Report: (\S+)/.exec(text)?.[1] ?? '', 'utf8')

test('a failing gate keeps the unit open and tells the agent what to fix, with the rule it enforces', async () => {
  prompt(session, 'change it')
  agentWrites(session, { [A_FILE]: 'export const a = 2\n' })

  const output = await finishWith(session, stubChecks([FAILING]))

  assert.equal(output.decision, 'block')
  assert.match(output.reason ?? '', /refusal 1 of 3/)
  assert.match(output.reason ?? '', /FAIL lint \(L1: The code passes the linter\.\)\n {2}src\/a\.ts:1:1 error max-lines-per-function/)
  assert.deepEqual(unitFiles(session), [A_FILE])
  assert.match(reportOf(output.reason ?? ''), /# Unit 1, round 1: checks failed/)
})

test('a refusal quotes the rules a failure is about, and never every rule of a check that does not say which one broke', async () => {
  const project = declaration({
    checks: {
      lint: { judge: ['true'], rules: { L1: 'No unused variable.', L2: 'No console call.', L3: 'Functions stay short.' } },
      markers: {
        judge: ['true'],
        reads: 'findings',
        rules: { M1: 'No FIXME is left.', M2: 'No TODO is left.', M3: 'No debugger is left.' },
      },
      format: { judge: ['true'], rules: { F1: 'Prettier decides formatting.' } },
    },
  })
  const failing = (
    id: string,
    rules: readonly string[],
    extra: Partial<ConstructorParameters<typeof CheckOutcome>[0]> = {},
  ): CheckOutcome => new CheckOutcome({ id, rules, status: 'fail', blocking: true, ms: 1, output: `${id} printed this`, ...extra })
  const todo = { rule: 'M2', file: A_FILE, line: 1, message: 'TODO left in' }

  prompt(session, 'change it', project)
  agentWrites(session, { [A_FILE]: 'export const a = 2\n' })

  const { reason = '' } = await finishWith(
    session,
    stubChecks([
      failing('lint', ['L1', 'L2', 'L3']),
      failing('markers', ['M1', 'M2', 'M3'], { failures: [todo, { ...todo, line: 2 }, { ...todo, rule: 'M1', message: 'FIXME left in' }] }),
      failing('format', ['F1'], { status: 'timeout' }),
      // A check that only lists places for the reviewer stands behind no rule of its own.
      failing('bare', []),
    ]),
    project,
  )

  assert.match(
    reason,
    /\nFAIL lint \(one of its 3 rules, written in \.weaver\/project\/checks\.json: what it printed says which\)\n {2}lint printed this\n/,
  )
  assert.match(reason, /\nFAIL markers \(M2: No TODO is left\. \| M1: No FIXME is left\.\)\n {2}M2 src\/a\.ts:1: TODO left in\n/)
  assert.match(reason, /\nTIMEOUT format \(F1: Prettier decides formatting\.\)\n/)
  assert.match(reason, /\nFAIL bare\n {2}bare printed this\n/)
  assert.doesNotMatch(reason, /No unused variable|No debugger/)
})

test('a check that fails without holding the task is listed for the owner under the rules it is known to be about', async () => {
  const several = new CheckOutcome({ ...FAILING, rules: ['L1', 'L2'], blocking: false })
  const one = new CheckOutcome({ ...FAILING, id: 'format', rules: ['F1'], blocking: false, output: 'src/a.ts is not formatted' })

  prompt(session, 'change it')
  agentWrites(session, { [A_FILE]: 'export const a = 2\n' })

  const { systemMessage = '' } = await finishWith(session, stubChecks([several, one]))

  assert.match(systemMessage, /2 items to validate\./)
  assert.match(reportOf(systemMessage), /\n- the check lint, behind 2 rules, reports: src\/a\.ts:1:1 error max-lines-per-function\n/)
  assert.match(reportOf(systemMessage), /\n- F1 the check format reports: src\/a\.ts is not formatted\n/)
})

test('after the refusals the project allows the agent may stop, with its unit still open; a new request starts them again', async () => {
  const project = declaration({ limits: { maxRefusals: 2 } })
  const checks = stubChecks([FAILING])

  prompt(session, 'change it')
  agentWrites(session, { [A_FILE]: 'export const a = 2\n' })

  assert.equal((await finishWith(session, checks, project)).decision, 'block')
  assert.equal((await finishWith(session, checks, project)).decision, 'block')

  const third = await finishWith(session, checks, project)

  assert.equal(third.decision, undefined)
  assert.match(third.systemMessage ?? '', /still fail after 2 refusals; the agent may stop/)
  assert.deepEqual(unitFiles(session), [A_FILE])

  prompt(session, 'try again')

  assert.equal((await finishWith(session, checks, project)).decision, 'block')
  assert.deepEqual(
    checksOf().map(({ round, passed, failed }) => ({ round, passed, failed })),
    [1, 2, 3, 1].map((round) => ({ round, passed: false, failed: ['lint'] })),
  )
  assert.deepEqual(readdirSync(join(session.dir, 'reports')), [
    '0001-unit-1-round-1.md',
    '0002-unit-1-round-2.md',
    '0003-unit-1-round-3.md',
    '0004-unit-1-round-1.md',
  ])
})

test('a pass settles the unit: the next one starts empty, and a file changed during the check stays for it', async () => {
  prompt(session, 'change both')
  agentWrites(session, { [A_FILE]: 'export const a = 2\n', [B_FILE]: 'export const b = 2\n' })

  const checks = stubChecks([PASSING], () => {
    agentWrites(session, { [B_FILE]: 'export const b = 3\n' })

    return Promise.resolve()
  })
  const output = await finishWith(session, checks)

  assert.match(output.systemMessage ?? '', /1 check passed on 2 changed files\./)
  assert.equal(stateOf(session)?.unit.number, 2)
  assert.deepEqual(unitFiles(session), [B_FILE])
  assert.deepEqual(stateOf(session)?.unit.intents, [])
})

test('the end of a task keeps where it is for whoever waits for it, and says where the time of a long one went', async () => {
  prompt(session, 'change a')
  agentWrites(session, { [A_FILE]: 'export const a = 2\n' })

  const seen: (ProgressRecord | null)[] = []
  const checks = stubChecks([new CheckOutcome({ ...PASSING, ms: 21 * 60_000 + 40_000 })], () => {
    seen.push(EndOfTaskProgress.read(session.dir))
    vi.setSystemTime(Date.now() + 26 * 60_000)

    return Promise.resolve()
  })

  vi.useFakeTimers({ toFake: ['Date'] })

  const output = await finishWith(session, checks).finally(() => vi.useRealTimers())
  const [during] = seen
  const after = EndOfTaskProgress.read(session.dir)

  assert.deepEqual(
    [during?.step, during?.endedAt, during?.checks.map((check) => check.id), during?.review],
    ['checks', null, ['lint'], null],
  )
  assert.deepEqual([after?.unit, after?.step, after?.outcome], [1, 'over', 'passed'])
  assert.match(output.systemMessage ?? '', /\. It took 26 min \d+ s: lint 21 min 40 s\. Report: /)
})

test('with a finish skill, a turn that ends without its headings checks nothing; the agent is told once how to end, and where it is written', async () => {
  const project = declaration({ finish: { headings: ['Request', 'To validate'], skill: '.agents/skills/wv-finish.md' } })
  const checks = stubChecks([PASSING])

  prompt(session, 'change it')
  agentWrites(session, { [A_FILE]: 'export const a = 2\n' })

  const told = await finishWith(session, checks, project, 'Which name do you prefer?')

  assert.equal(told.decision, 'block')
  assert.equal(
    told.reason,
    '[weaver] This unit of work has changed files, and your last message does not end it. If the work is finished, end with a message that has these sections: ## Request, ## To validate. How to write them is in .agents/skills/wv-finish.md. If you are waiting for the owner, say so and stop: this is said once.',
  )
  assert.match((await finishWith(session, checks, project, 'I am waiting for your answer.')).systemMessage ?? '', /Checks pending/)
  prompt(session, 'call it b')
  assert.equal((await finishWith(session, checks, project, 'Done, I think.')).decision, 'block', 'a new request may be told again')
  assert.equal(checks.calls.count, 0)

  await finishWith(session, checks, project, '## request\n\ndone\n\n## To Validate ##\n\nnothing\n')

  assert.equal(checks.calls.count, 1, 'headings are matched whatever their case and trailing marks')
  assert.deepEqual(unitFiles(session), [])
})

test('what waits for the owner is counted, listed in the report and never blocks the agent; a script that rewrote the configuration is caught there', async () => {
  const finding = { rule: 'S1', file: A_FILE, line: 1, message: 'eslint-disable added' }
  const project = declaration({
    checks: {
      lint: LINT,
      markers: { judge: ['true'], reads: 'findings', rules: { S1: { statement: 'A suppression needs approval.', level: 'human' } } },
    },
  })

  prompt(session, 'change it')
  agentWrites(session, { [A_FILE]: '// eslint-disable-next-line\nexport const a = 2\n' })
  writeFiles(session.repo.top, { '.weaver/settings.json': '{}\n' })
  agentRuns(session, "python3 -c \"open('.weaver/settings.json', 'w').write('{}')\"", () => {
    writeFiles(session.repo.top, { '.weaver/settings.json': '{"version":2}\n' })
  })

  const markers = new CheckOutcome({ ...PASSING, id: 'markers', rules: ['S1'], toValidate: [finding] })
  const output = await finishWith(session, stubChecks([PASSING, markers]), project)
  const report = reportOf(output.systemMessage ?? '')

  assert.match(output.systemMessage ?? '', /2 items to validate\./)
  assert.match(
    report,
    /## To validate\n\n- src\/a\.ts\n {2}- S1, line 1: eslint-disable added\n- weaver:declaration, \.weaver: the unit changed the project's declaration/,
  )
  assert.equal(checksOf()[0]?.toValidate, 2)
  assert.deepEqual(unitFiles(session), [])
})

test('an agent that waits for a task it left running is not reminded how to end its work, until the task ends', async () => {
  const project = declaration({ finish: { headings: ['Request'] } })
  const checks = stubChecks([PASSING])
  const notified = (task: string, status: string | null): string =>
    `<task-notification>\n<task-id>${task}</task-id>\n${status === null ? '<event>seed at 40%</event>' : `<status>${status}</status>`}\n</task-notification>`

  prompt(session, 'seed the bench, then measure', project)
  agentWrites(session, { [A_FILE]: 'export const a = 2\n' })
  startTool(session, { ...bashCall('./seed.sh', { run_in_background: true }), tool_response: { backgroundTaskId: 'b1' } }, project)()
  startTool(
    session,
    { tool_name: 'Monitor', tool_input: { command: 'tail -f seed.log' }, tool_response: { taskId: 'b2', timeoutMs: 1800000 } },
    project,
  )()

  const waiting = await finishWith(session, checks, project, 'The seed runs: I go on when it ends.')

  assert.equal(waiting.decision, undefined)
  assert.match(waiting.systemMessage ?? '', /Checks pending/)

  prompt(session, notified('b2', null), project)
  prompt(session, notified('b2', 'completed'), project)
  prompt(session, notified('b1', null), project)

  assert.equal((await finishWith(session, checks, project, 'Still seeding.')).decision, undefined, 'b1 has not ended')

  prompt(session, notified('b1', 'failed'), project)

  const reminded = await finishWith(session, checks, project, 'The seed failed; I look into it.')

  assert.equal(reminded.decision, 'block')
  assert.match(reminded.reason ?? '', /your last message does not end it/)
  assert.equal(checks.calls.count, 0)
})

test('an agent that waits for a subagent it sent to the background is not reminded, until the subagent ends', async () => {
  const project = declaration({ finish: { headings: ['Request'] } })
  const checks = stubChecks([PASSING])

  prompt(session, 'measure it with a subagent', project)
  agentWrites(session, { [A_FILE]: 'export const a = 2\n' })
  startTool(
    session,
    {
      tool_name: 'Agent',
      tool_input: { prompt: 'measure', run_in_background: 'true' },
      tool_response: { isAsync: true, status: 'async_launched', agentId: 'a1' },
    },
    project,
  )()

  assert.equal((await finishWith(session, checks, project, 'The subagent measures.')).decision, undefined)

  prompt(session, '<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n</task-notification>', project)

  assert.equal((await finishWith(session, checks, project, 'It measured.')).decision, 'block')
})

test('a task whose end the runtime never tells is given up on once the time it was given has passed', async () => {
  const project = declaration({ finish: { headings: ['Request'] } })

  prompt(session, 'watch it', project)
  agentWrites(session, { [A_FILE]: 'export const a = 2\n' })
  startTool(
    session,
    { tool_name: 'Monitor', tool_input: { command: 'tail -f x.log' }, tool_response: { taskId: 'b3', timeoutMs: 1 } },
    project,
  )()
  await new Promise((resolve) => setTimeout(resolve, 5))

  assert.equal((await finishWith(session, stubChecks([PASSING]), project, 'Watching.')).decision, 'block')
})
