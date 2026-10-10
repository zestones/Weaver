import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import { Session } from '../../src/unit-of-work/session/session.ts'
import type { EventOf } from '../../src/unit-of-work/journal/journal-event.ts'
import { SAMPLE_REPO, git, makeRepo, writeFiles } from '../fixtures/repo.ts'
import {
  A_FILE,
  agentRuns,
  agentWrites,
  B_FILE,
  bashCall,
  declaration,
  eventsOf,
  finishWith,
  PASSING,
  prompt,
  startTool,
  stateOf,
  stubChecks,
  unitFiles,
} from '../fixtures/session.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-unit-files-'))

let session: Session
let counter = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  session = new Session(makeRepo(join(scratch, `repo-${String(counter)}`), SAMPLE_REPO), 's', 'claude')
})

const settles = (): EventOf<'settle'>[] => eventsOf(session, 'settle')
const ownerGit = (args: readonly string[]): string => git(session.repo.top, args)

test('a file the session did not touch is not its to check', async () => {
  writeFiles(session.repo.top, { [B_FILE]: 'export const b = 1\n' })
  prompt(session, 'explain')

  const checks = stubChecks([PASSING])

  assert.deepEqual(await finishWith(session, checks), {})
  assert.equal(checks.calls.count, 0)
})

test('a file written back to its base leaves the unit', () => {
  prompt(session, 'try it')
  agentWrites(session, { [A_FILE]: 'export const a = 4\n' })
  agentWrites(session, { [A_FILE]: 'export const a = 1\n' })

  assert.deepEqual(unitFiles(session), [])
})

test('an edit by the owner in a file of the unit marks it foreign and is checked with it', async () => {
  prompt(session, 'change it')
  agentWrites(session, { [A_FILE]: 'export const a = 5\n' })
  writeFiles(session.repo.top, { [A_FILE]: 'export const a = 55\n' })

  const checks = stubChecks([PASSING])

  assert.match((await finishWith(session, checks)).systemMessage ?? '', /1 check\(s\) passed on 1 changed file/)
  assert.deepEqual(checks.seen, [[A_FILE]])
})

test("the owner's commit settles the files it holds, with a note in the journal", async () => {
  prompt(session, 'change it')
  agentWrites(session, { [A_FILE]: 'export const a = 6\n', [B_FILE]: 'export const b = 6\n' })
  ownerGit(['add', A_FILE])
  ownerGit(['commit', '-qm', 'mine'])

  const checks = stubChecks([PASSING])

  await finishWith(session, checks)

  assert.deepEqual(checks.seen, [[B_FILE]])
  assert.deepEqual(
    settles().map(({ by, notes }) => ({ by, notes })),
    [
      { by: 'owner', notes: [`${A_FILE} settled by your git action`] },
      { by: 'check', notes: [] },
    ],
  )
})

test("the owner's commit of other files leaves the unit's files where they are", async () => {
  prompt(session, 'change it')
  agentWrites(session, { [A_FILE]: 'export const a = 8\n' })
  writeFiles(session.repo.top, { [A_FILE]: 'export const a = 9\n', 'notes.md': 'mine\n' })
  ownerGit(['add', 'notes.md'])
  ownerGit(['commit', '-qm', 'notes'])

  const checks = stubChecks([PASSING])

  await finishWith(session, checks)

  assert.deepEqual(checks.seen, [[A_FILE]])
})

test("the owner's commit of part of a file keeps the rest as the agent's work", () => {
  prompt(session, 'change it')
  agentWrites(session, { [A_FILE]: 'export const a = 10\n' })
  ownerGit(['add', A_FILE])
  agentWrites(session, { [A_FILE]: 'export const a = 11\n' })
  ownerGit(['commit', '-qm', 'part'])
  prompt(session, 'go on')

  const file = stateOf(session)?.unit.files[A_FILE]

  assert.equal(file?.base, git(session.repo.top, ['rev-parse', `HEAD:${A_FILE}`]))
})

test("the owner's stash takes the file out of the unit", async () => {
  prompt(session, 'change it')
  agentWrites(session, { [A_FILE]: 'export const a = 7\n' })
  ownerGit(['stash', '-q'])

  assert.deepEqual(await finishWith(session, stubChecks([PASSING])), {})
  assert.deepEqual(unitFiles(session), [])
})

test('a commit made by the agent itself settles nothing: its files are still checked', async () => {
  prompt(session, 'change it and commit')
  agentWrites(session, { [A_FILE]: 'export const a = 12\n' })

  const answer = agentRuns(session, 'git commit -am mine', () => {
    ownerGit(['commit', '-qam', 'by the agent'])
  })
  const checks = stubChecks([PASSING])

  await finishWith(session, checks)

  assert.match(answer.body?.systemMessage ?? '', /moved HEAD/)
  assert.deepEqual(checks.seen, [[A_FILE]])
  assert.deepEqual(
    settles().map(({ by }) => by),
    ['check'],
  )
  assert.equal(eventsOf(session, 'head-moved').length, 1)
})

test('a shell command is charged with what it certainly writes; the rest that changed meanwhile is only shown', () => {
  prompt(session, 'generate it')
  agentRuns(session, `echo x > ${B_FILE}`, () => {
    writeFiles(session.repo.top, { [B_FILE]: 'x\n', [A_FILE]: 'export const a = 99\n', 'ignored/cache.txt': 'x\n' })
  })

  assert.deepEqual(unitFiles(session), [B_FILE])
  assert.deepEqual(stateOf(session)?.unit.unattributed, [A_FILE])

  agentRuns(session, 'node generate.js', () => {
    writeFiles(session.repo.top, { 'src/c.ts': 'export const c = 1\n' })
  })

  assert.deepEqual(unitFiles(session), [B_FILE], 'an unknown script is not charged')

  agentRuns(session, "python3 -c \"open('src/d.ts', 'w').write('x')\"", () => {
    writeFiles(session.repo.top, { 'src/d.ts': 'x\n' })
  })
  agentRuns(session, 'npm run generate', () => {
    writeFiles(session.repo.top, { 'src/e.ts': 'export const e = 1\n' })
  })

  assert.deepEqual(unitFiles(session), [B_FILE, 'src/d.ts', 'src/e.ts'])
})

test('a script the project declares as a generator is charged with what it wrote', () => {
  const project = declaration({ scripts: { writers: ['node generate.js'] } })

  prompt(session, 'generate it')
  agentRuns(
    session,
    'node generate.js',
    () => {
      writeFiles(session.repo.top, { 'src/c.ts': 'export const c = 1\n' })
    },
    project,
  )

  assert.deepEqual(unitFiles(session), ['src/c.ts'])
})

test('a command made of a writer and a reader is charged with what the writer names, nothing else', () => {
  prompt(session, 'fix and test it')
  agentRuns(session, `sed -i s/1/2/ ${A_FILE} && npx vitest run`, () => {
    writeFiles(session.repo.top, { [A_FILE]: 'export const a = 2\n', 'notes.md': 'x\n' })
  })

  assert.deepEqual(unitFiles(session), [A_FILE])
})

test('a command run in the background keeps its window until the turn ends', () => {
  const project = declaration({ scripts: { writers: ['npm run api:types'] } })

  prompt(session, 'run the codegen in the background')
  startTool(session, bashCall('npm run api:types', { run_in_background: true }), project)()
  writeFiles(session.repo.top, { [A_FILE]: 'export const a = 3\n' })

  assert.deepEqual(unitFiles(session), [], 'the call returned before its command wrote anything')

  session.closeOpenCalls()

  assert.deepEqual(unitFiles(session), [A_FILE])
  assert.deepEqual(stateOf(session)?.pending, {})
})

test("the session's own calls running side by side do not make its files foreign", () => {
  prompt(session, 'change it twice')

  const command = startTool(session, bashCall(`sed -i s/1/2/ ${A_FILE}`))

  agentWrites(session, { [A_FILE]: 'export const a = 4\n' })
  writeFiles(session.repo.top, { [A_FILE]: 'export const a = 5\n' })
  command()

  assert.equal(stateOf(session)?.unit.files[A_FILE]?.foreign, false)
})

test('two sessions never charge each other: each unit holds what its own calls changed', async () => {
  const other = new Session(session.repo, 'other', 'codex')

  prompt(session, 'change a')
  prompt(other, 'change b')
  agentWrites(session, { [A_FILE]: 'export const a = 20\n' })
  agentWrites(other, { [B_FILE]: 'export const b = 20\n' })

  const checks = stubChecks([PASSING])

  await finishWith(session, checks)

  assert.deepEqual(checks.seen, [[A_FILE]])
  assert.deepEqual(unitFiles(other), [B_FILE])
})

test('a prompt records its intent on the unit, with the reply it answers', async () => {
  prompt(session, 'first')
  await finishWith(session, stubChecks([PASSING]), declaration({ finish: { headings: ['Request'] } }), 'Should I rename it too?')
  prompt(session, 'yes')

  assert.deepEqual(
    stateOf(session)?.unit.intents.map(({ text, answering }) => ({ text, answering })),
    [
      { text: 'first', answering: null },
      { text: 'yes', answering: 'Should I rename it too?' },
    ],
  )
})

test("the owner's commit is journaled at the next prompt, and a new request gives the checks their rounds again", () => {
  prompt(session, 'change it')
  agentWrites(session, { [A_FILE]: 'export const a = 70\n' })
  for (let round = 0; round < 3; round += 1) session.failRound()
  ownerGit(['add', A_FILE])
  ownerGit(['commit', '-qm', 'mine'])
  prompt(session, 'next')

  assert.deepEqual(settles()[0]?.notes, [`${A_FILE} settled by your git action`])
  assert.equal(stateOf(session)?.unit.check.rounds, 0)
})
