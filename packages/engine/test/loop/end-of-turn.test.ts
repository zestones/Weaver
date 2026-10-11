import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import { CheckOutcome } from '../../src/checks/results/check-outcome.ts'
import { Session } from '../../src/unit-of-work/session/session.ts'
import type { EventOf } from '../../src/unit-of-work/journal/journal-event.ts'
import { SAMPLE_REPO, makeRepo, writeFiles } from '../fixtures/repo.ts'
import {
  A_FILE,
  agentRuns,
  agentWrites,
  B_FILE,
  declaration,
  eventsOf,
  FAILING,
  finishWith,
  LINT,
  PASSING,
  prompt,
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

test('after the refusals the project allows the agent may stop, with its unit still open; a new request starts them again', async () => {
  const project = declaration({ limits: { maxRefusals: 2 } })
  const checks = stubChecks([FAILING])

  prompt(session, 'change it')
  agentWrites(session, { [A_FILE]: 'export const a = 2\n' })

  assert.equal((await finishWith(session, checks, project)).decision, 'block')
  assert.equal((await finishWith(session, checks, project)).decision, 'block')

  const third = await finishWith(session, checks, project)

  assert.equal(third.decision, undefined)
  assert.match(third.systemMessage ?? '', /still fail after 2 refusal\(s\); the agent may stop/)
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

  assert.match(output.systemMessage ?? '', /1 check\(s\) passed on 2 changed file\(s\)\./)
  assert.equal(stateOf(session)?.unit.number, 2)
  assert.deepEqual(unitFiles(session), [B_FILE])
  assert.deepEqual(stateOf(session)?.unit.intents, [])
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
      markers: { verify: ['true'], reads: 'findings', rules: { S1: { statement: 'A suppression needs approval.', level: 'human' } } },
    },
  })

  prompt(session, 'change it')
  agentWrites(session, { [A_FILE]: '// eslint-disable-next-line\nexport const a = 2\n' })
  writeFiles(session.repo.top, { '.weaver/settings.json': '{}\n' })
  agentRuns(session, "python3 -c \"open('.weaver/settings.json', 'w').write('{}')\"", () => {
    writeFiles(session.repo.top, { '.weaver/settings.json': '{"version":1}\n' })
  })

  const markers = new CheckOutcome({ ...PASSING, id: 'markers', rules: ['S1'], toValidate: [finding] })
  const output = await finishWith(session, stubChecks([PASSING, markers]), project)
  const report = reportOf(output.systemMessage ?? '')

  assert.match(output.systemMessage ?? '', /2 item\(s\) to validate\./)
  assert.match(
    report,
    /## To validate\n\n- S1 src\/a\.ts:1: eslint-disable added\n- weaver:declaration \.weaver: the unit changed the project's declaration/,
  )
  assert.equal(checksOf()[0]?.toValidate, 2)
  assert.deepEqual(unitFiles(session), [])
})
