import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import { ChecksOnDemand } from '../../src/loop/on-demand/checks-on-demand.ts'
import { HeldElsewhere } from '../../src/unit-of-work/session/held-elsewhere.ts'
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

test('a call the runtime never ran gives no base when the turn ends: a file written back stays out of the unit', () => {
  prompt(session, 'try it, then undo it')
  agentWrites(session, { [A_FILE]: 'export const a = 4\n' })
  // The runtime denies the call after the hook has seen it: no hook comes after it.
  startTool(session, bashCall(`git show HEAD:${A_FILE} > /tmp/a.ts && cp /tmp/a.ts ${A_FILE}`))
  agentWrites(session, { [A_FILE]: 'export const a = 1\n' })

  session.closeOpenCalls()

  assert.deepEqual(unitFiles(session), [])
})

test('a command still running in the background when a file is written back gives it no base either', () => {
  prompt(session, 'try it, then undo it')
  agentWrites(session, { [A_FILE]: 'export const a = 4\n' })
  startTool(session, bashCall('npx prettier --write src', { run_in_background: true }))()
  agentWrites(session, { [A_FILE]: 'export const a = 1\n' })
  agentWrites(session, { [B_FILE]: 'export const b = 2\n' })

  session.closeOpenCalls()

  assert.deepEqual(unitFiles(session), [B_FILE])
  assert.equal(stateOf(session)?.unit.files[B_FILE]?.base, null)
})

test('a call that started before the session first wrote a file saw it first: what it saw is the base', () => {
  prompt(session, 'change it')

  const command = startTool(session, bashCall(`sed -i s/1/2/ ${A_FILE}`))

  writeFiles(session.repo.top, { [A_FILE]: 'export const a = 2\n' })
  agentWrites(session, { [A_FILE]: 'export const a = 3\n' })
  command()

  assert.equal(stateOf(session)?.unit.files[A_FILE]?.base, git(session.repo.top, ['rev-parse', `HEAD:${A_FILE}`]))
})

test('an edit by the owner in a file of the unit marks it foreign and is checked with it', async () => {
  prompt(session, 'change it')
  agentWrites(session, { [A_FILE]: 'export const a = 5\n' })
  writeFiles(session.repo.top, { [A_FILE]: 'export const a = 55\n' })

  const checks = stubChecks([PASSING])

  assert.match((await finishWith(session, checks)).systemMessage ?? '', /1 check passed on 1 changed file/)
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

  const output = answer.body?.hookSpecificOutput

  assert.match(answer.body?.systemMessage ?? '', /HEAD moved while the Bash call ran, by the call or by the owner meanwhile/)
  assert.match(
    output !== undefined && 'additionalContext' in output ? output.additionalContext : '',
    /Commits are the owner's/,
    'the agent hears it too',
  )
  assert.deepEqual(checks.seen, [[A_FILE]])
  assert.deepEqual(
    settles().map(({ by }) => by),
    ['check'],
  )
  assert.equal(eventsOf(session, 'head-moved').length, 1)
})

test('a command whose words name all it writes is charged with those; the rest that changed meanwhile is only shown', () => {
  prompt(session, 'generate it')
  agentRuns(session, `echo x > ${B_FILE}`, () => {
    writeFiles(session.repo.top, { [B_FILE]: 'x\n', [A_FILE]: 'export const a = 99\n', 'ignored/cache.txt': 'x\n' })
  })

  assert.deepEqual(unitFiles(session), [B_FILE])
  assert.deepEqual(stateOf(session)?.unit.unattributed, [A_FILE])

  agentRuns(session, 'node generate.js', () => {
    writeFiles(session.repo.top, { 'src/c.ts': 'export const c = 1\n' })
  })

  assert.deepEqual(unitFiles(session), [B_FILE, 'src/c.ts'], 'a script is charged with all that changed while it ran')

  agentRuns(session, "python3 -c \"open('src/d.ts', 'w').write('x')\"", () => {
    writeFiles(session.repo.top, { 'src/d.ts': 'x\n' })
  })
  agentRuns(session, 'npm run generate', () => {
    writeFiles(session.repo.top, { 'src/e.ts': 'export const e = 1\n' })
  })

  assert.deepEqual(unitFiles(session), [B_FILE, 'src/c.ts', 'src/d.ts', 'src/e.ts'])
})

test('a script is never charged with a file another session works on, unless that session left it as HEAD holds it', () => {
  const other = new Session(session.repo, 'other', 'codex')

  prompt(session, 'extract it')
  prompt(other, 'change b and a')
  agentWrites(other, { [B_FILE]: 'export const b = 30\n', [A_FILE]: 'export const a = 30\n' })
  ownerGit(['add', A_FILE])
  ownerGit(['commit', '-qm', 'the owner takes a'])
  agentRuns(session, 'python3 tools/extract.py', () => {
    writeFiles(session.repo.top, {
      [A_FILE]: 'export const a = 31\n',
      [B_FILE]: 'export const b = 31\n',
      'src/c.ts': 'export const c = 31\n',
    })
  })

  assert.deepEqual(unitFiles(session), [A_FILE, 'src/c.ts'])
  assert.deepEqual(stateOf(session)?.unit.unattributed, [B_FILE])
})

test('a session left for hours holds no file, however others look at it: a script of another session is charged with it', () => {
  const left = new Session(session.repo, 'left', 'claude')

  prompt(left, 'change b')
  agentWrites(left, { [B_FILE]: 'export const b = 30\n' })

  const hoursAgo = new Date(Date.now() - HeldElsewhere.LEFT_AFTER_MS - 60_000)

  utimesSync(join(left.dir, 'state.json'), hoursAgo, hoursAgo)
  assert.equal(new ChecksOnDemand(session.repo).sessionAsking(['lint']), null, 'the owner runs weaver check meanwhile')
  prompt(session, 'extract it')
  agentRuns(session, 'python3 tools/extract.py', () => {
    writeFiles(session.repo.top, { [B_FILE]: 'export const b = 31\n' })
  })

  assert.deepEqual(unitFiles(session), [B_FILE])
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
