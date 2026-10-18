import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import { CheckMemory } from '../../src/checks/results/check-memory.ts'
import type { CheckOutcome } from '../../src/checks/results/check-outcome.ts'
import { ProjectChecks } from '../../src/checks/running/project-checks.ts'
import type { Repository } from '../../src/lib/git/repository.ts'
import { EndOfTaskProgress } from '../../src/loop/progress/end-of-task-progress.ts'
import { TreeDiff } from '../../src/lib/git/tree-diff.ts'
import { WorkingTreeSnapshot } from '../../src/lib/git/working-tree-snapshot.ts'
import { UnitDiff } from '../../src/unit-of-work/diff/unit-diff.ts'
import { Session } from '../../src/unit-of-work/session/session.ts'
import { declarationOf } from '../fixtures/declaration.ts'
import { git, makeRepo, writeFiles } from '../fixtures/repo.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-checks-'))
const REPORTER = "process.stdout.write('noise\\n' + process.argv[2]); process.exitCode = Number(process.argv[3] ?? 0)"
let repo: Repository
let counter = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  repo = makeRepo(join(scratch, `repo-${String(counter)}`), {
    'src/a.js': 'export const a = 1\n',
    'docs/guide.md': '# Guide\n',
    'reporter.mjs': REPORTER,
  })
})

const reporter = (findings: unknown, exit = 0): string[] => ['node', 'reporter.mjs', JSON.stringify(findings), String(exit)]

function unitDiff(): UnitDiff {
  const { dir } = new Session(repo, 's', 'claude')
  const base = git(repo.top, ['rev-parse', 'HEAD^{tree}'])
  const head = new WorkingTreeSnapshot(repo, dir).tree()
  const files = new TreeDiff(repo, base, head).files([])

  return new UnitDiff({ repo, dir, base, head, files, excluded: [] })
}

async function run(declaration: Record<string, unknown>): Promise<Record<string, CheckOutcome>> {
  const project = declarationOf(declaration)
  const outcomes = await new ProjectChecks().judge(project, unitDiff(), project.checkLimits.deadlineFrom(Date.now()))

  return Object.fromEntries(outcomes.map((outcome) => [outcome.id, outcome]))
}

const gate = (name: string) => ({ [name]: 'A program settles it.' })
const human = (name: string) => ({ [name]: { statement: 'The owner settles it.', level: 'human' } })

test('the exit status of a check is its verdict, and its rules say whether a failure blocks', async () => {
  writeFiles(repo.top, { 'src/a.js': 'export const a = 2\n' })

  const outcomes = await run({
    checks: {
      ok: { judge: ['true'], rules: gate('G1') },
      broken: { judge: ['sh', '-c', 'echo boom >&2; exit 3'], rules: gate('G2') },
      advisory: { judge: ['false'], rules: human('H1') },
    },
  })

  assert.deepEqual([outcomes.ok?.status, outcomes.ok?.blocking], ['pass', false])
  assert.deepEqual([outcomes.broken?.status, outcomes.broken?.blocking, outcomes.broken?.output.trim()], ['fail', true, 'boom'])
  assert.deepEqual([outcomes.advisory?.status, outcomes.advisory?.blocking], ['fail', false], 'no gate rule stands behind it')
})

test('a check runs only when the unit changed a file it is about, and is handed those files', async () => {
  writeFiles(repo.top, { 'src/a.js': 'export const a = 2\n', 'src/new.js': 'export const b = 1\n' })
  git(repo.top, ['rm', '-q', 'docs/guide.md'])

  const outcomes = await run({
    checks: {
      names: { judge: ['sh', '-c', 'echo "$@"; exit 1', 'sh', '{files}'], when: ['src/**/*.js'], cwd: 'src', rules: gate('G1') },
      sql: { judge: ['false'], when: ['**/*.sql'], rules: gate('G2') },
      docs: { judge: ['false', '{files}'], when: ['docs/**'], rules: gate('G3') },
    },
  })

  assert.equal(outcomes.names?.output.trim(), 'a.js new.js', 'relative to where the check runs')
  assert.deepEqual([outcomes.sql?.status, outcomes.sql?.reason], ['skip', 'the unit changed none of the files it is about'])
  assert.deepEqual([outcomes.docs?.status, outcomes.docs?.reason], ['skip', 'the files it is about were all deleted'])
})

test('each finding goes where the level of its rule sends it', async () => {
  writeFiles(repo.top, { 'src/a.js': 'export const a = 2\n' })

  const findings = {
    findings: [
      { rule: 'M1', file: 'src/a.js', line: 1, message: 'FIXME left in' },
      { rule: 'M2', file: 'src/a.js', line: 1, message: 'eslint-disable added' },
    ],
  }
  const outcomes = await run({
    checks: {
      mixed: { judge: reporter(findings), reads: 'findings', rules: { ...gate('M1'), ...human('M2') } },
      advisory: { judge: reporter({ findings: [findings.findings[1]] }), reads: 'findings', rules: human('M3') },
    },
  })

  assert.deepEqual([outcomes.mixed?.status, outcomes.mixed?.blocking], ['fail', true])
  assert.deepEqual(outcomes.mixed?.failures, [findings.findings[0]])
  assert.deepEqual(outcomes.mixed?.toValidate, [findings.findings[1]])
  assert.equal(outcomes.advisory?.reason, 'a finding names M2, a rule this check does not stand behind')
})

test('findings only the owner settles pass the check and wait for them', async () => {
  writeFiles(repo.top, { 'src/a.js': 'export const a = 2\n' })

  const finding = { rule: 'M2', file: 'src/a.js', message: 'eslint-disable added' }
  const outcomes = await run({ checks: { c: { judge: reporter({ findings: [finding] }), reads: 'findings', rules: human('M2') } } })

  assert.deepEqual([outcomes.c?.status, outcomes.c?.blocking, outcomes.c?.toValidate], ['pass', false, [finding]])
})

test('a check that cannot give its verdict fails: no output, no JSON, a crash or a missing program', async () => {
  writeFiles(repo.top, { 'src/a.js': 'export const a = 2\n' })

  const outcomes = await run({
    checks: {
      silent: { judge: ['true'], reads: 'findings', rules: gate('G1') },
      shapeless: { judge: reporter({ findings: [{ rule: 'G2' }] }), reads: 'findings', rules: gate('G2') },
      crashed: { judge: reporter({ findings: [] }, 2), reads: 'findings', rules: gate('G3') },
      missing: { judge: ['weaver-no-such-command'], rules: gate('G4') },
    },
  })

  for (const id of ['silent', 'shapeless', 'crashed', 'missing'])
    assert.deepEqual([id, outcomes[id]?.status, outcomes[id]?.blocking], [id, 'fail', true])

  assert.equal(outcomes.silent?.reason, 'the check did not print its findings as JSON on its last line')
  assert.equal(outcomes.crashed?.reason, 'the check exited with 2')
  assert.match(outcomes.missing?.output ?? '', /ENOENT/)
})

test('a check that outlives its own timeout times out, and the check that reads its output does not run', async () => {
  writeFiles(repo.top, { 'src/a.js': 'export const a = 2\n' })

  const outcomes = await run({
    checks: {
      reader: { judge: ['true'], after: 'slow', rules: gate('G1') },
      slow: { judge: ['sleep', '30'], timeoutSeconds: 1, rules: gate('G2') },
    },
  })

  assert.deepEqual([outcomes.slow?.status, outcomes.slow?.blocking], ['timeout', true])
  assert.equal(outcomes.slow?.reason, 'It ran past its own limit of 1 s: `timeoutSeconds` of the check in .weaver/project/checks.json.')
  assert.deepEqual([outcomes.reader?.status, outcomes.reader?.reason], ['skip', 'slow did not finish'])
})

test('the checks share one time: a check still running when it ends times out, whatever its own timeout', async () => {
  writeFiles(repo.top, { 'src/a.js': 'export const a = 2\n' })

  const outcomes = await run({
    limits: { totalTimeoutSeconds: 1 },
    checks: { slow: { judge: ['sleep', '30'], rules: gate('G1') }, quick: { judge: ['true'], rules: gate('G2') } },
  })

  assert.deepEqual([outcomes.slow?.status, outcomes.quick?.status], ['timeout', 'pass'])
  assert.equal(
    outcomes.slow?.reason,
    'The time the checks share ran out before its own limit of 600 s: `checks.totalTimeoutSeconds` in .weaver/settings.json.',
    'the limit that stopped it is the one named',
  )
})

test('the repairs take their time from the one the checks share: out of time, a repair is not started', async () => {
  writeFiles(repo.top, { 'src/a.js': 'export const a = 2\n' })

  const project = declarationOf({
    limits: { totalTimeoutSeconds: 1 },
    checks: {
      slow: { repair: ['sleep', '30'], judge: ['true'], rules: gate('G1') },
      late: { repair: ['sh', '-c', 'echo repaired > late.txt'], judge: ['true'], rules: gate('G2') },
    },
  })
  const deadline = project.checkLimits.deadlineFrom(Date.now())
  const checks = new ProjectChecks()

  await checks.repair(project, unitDiff(), deadline)

  assert.ok(Date.now() >= deadline, 'the repair that sleeps held the whole time, and no longer')
  assert.equal(existsSync(join(repo.top, 'late.txt')), false)
  assert.deepEqual(
    (await checks.judge(project, unitDiff(), deadline)).map((outcome) => outcome.status),
    ['pass', 'pass'],
    'the checks still give their verdict',
  )
})

test('a check is told the two trees and reads the diff of the unit as a file, added lines included', async () => {
  writeFiles(repo.top, { 'src/a.js': 'export const a = 1\nexport const b = 2\n' })

  const script =
    "const diff = JSON.parse(require('fs').readFileSync(process.env.WEAVER_UNIT_DIFF)); console.log(JSON.stringify([diff, process.env.WEAVER_BASE_TREE, process.env.WEAVER_HEAD_TREE]))"
  const outcomes = await run({ checks: { c: { judge: ['node', '-e', script], rules: gate('G1') } } })
  const [diff, base, head] = JSON.parse(outcomes.c?.output ?? '') as [unknown, string, string]

  assert.deepEqual(diff, [{ status: 'M', path: 'src/a.js', oldPath: 'src/a.js', added: [[2, 2]] }])
  assert.equal(base, git(repo.top, ['rev-parse', 'HEAD^{tree}']))
  assert.match(head, /^[0-9a-f]{40}$/)
})

test('checks that wait for each other in a loop are reported, never waited for', async () => {
  writeFiles(repo.top, { 'src/a.js': 'export const a = 2\n' })

  const outcomes = await run({
    checks: { one: { judge: ['true'], after: 'two', rules: gate('G1') }, two: { judge: ['true'], after: 'one', rules: gate('G2') } },
  })

  assert.equal(outcomes.one?.reason, 'the check never started: its `after` chain loops')
  assert.equal(outcomes.two?.blocking, true)
})

test('a check given the same two trees again gives its verdict again without running; a change of a file runs it', async () => {
  const runs = join(scratch, `runs-${String(counter)}.txt`)
  const counting = `require('fs').appendFileSync(${JSON.stringify(runs)}, 'x'); process.exitCode = 1`
  const project = declarationOf({
    checks: {
      slow: { judge: ['node', '-e', counting], rules: gate('G1') },
      timed: { judge: ['sleep', '5'], timeoutSeconds: 1, rules: gate('G2') },
    },
  })
  const memory = new CheckMemory(new Session(repo, 's', 'claude').dir)
  const judged = async (): Promise<Record<string, CheckOutcome>> => {
    const outcomes = await new ProjectChecks().judge(project, unitDiff(), project.checkLimits.deadlineFrom(Date.now()), memory)

    return Object.fromEntries(outcomes.map((outcome) => [outcome.id, outcome]))
  }

  writeFiles(repo.top, { 'src/a.js': 'export const a = 2\n' })

  const first = await judged()
  const again = await judged()

  assert.equal(readFileSync(runs, 'utf8'), 'x', 'the second verdict came from memory')
  assert.equal(first.slow?.keptFrom, null)
  assert.match(again.slow?.keptFrom ?? '', /^\d{4}-\d\d-\d\dT/)
  assert.deepEqual([again.slow?.status, again.slow?.blocking, again.slow?.run.kept], ['fail', true, true])
  assert.deepEqual([again.timed?.status, again.timed?.keptFrom], ['timeout', null], 'a run out of time says nothing of the files')

  writeFiles(repo.top, { 'src/a.js': 'export const a = 3\n' })
  await judged()

  assert.equal(readFileSync(runs, 'utf8'), 'xx')
})

test('the end of a task keeps where its checks are, as they start and end, for whoever waits for it', async () => {
  writeFiles(repo.top, { 'src/a.js': 'export const a = 2\n' })

  const project = declarationOf({
    checks: {
      lint: { judge: ['true'], rules: gate('G1') },
      tests: { judge: ['sleep', '1'], after: 'lint', rules: gate('G2') },
      types: { judge: ['false'], rules: gate('G3') },
    },
  })
  const dir = join(repo.gitDir, 'weaver', 'progress-test')

  mkdirSync(dir, { recursive: true })

  const progress = new EndOfTaskProgress(dir, 3, ['lint', 'tests', 'types'], false)
  const seen: string[] = []
  const watching = {
    started: (id: string) => {
      progress.started(id)
      seen.push(`${id} ${EndOfTaskProgress.read(dir)?.checks.find((check) => check.id === id)?.status ?? ''}`)
    },
    ended: (outcome: CheckOutcome) => {
      progress.ended(outcome)
    },
  }

  await new ProjectChecks().judge(project, unitDiff(), project.checkLimits.deadlineFrom(Date.now()), undefined, watching)
  progress.over('the checks send the agent back')

  const kept = EndOfTaskProgress.read(dir)

  assert.deepEqual(seen.sort(), ['lint running', 'tests running', 'types running'])
  assert.deepEqual(
    kept?.checks.map(({ id, status }) => [id, status]),
    [
      ['lint', 'pass'],
      ['tests', 'pass'],
      ['types', 'fail'],
    ],
  )
  assert.ok((kept?.checks.find((check) => check.id === 'tests')?.ms ?? 0) >= 1000)
  assert.deepEqual([kept?.unit, kept?.step, kept?.outcome, kept?.endedAt !== null], [3, 'over', 'the checks send the agent back', true])
  assert.equal(kept !== null && EndOfTaskProgress.isCut(kept), false, 'its hook is this process, alive')
})
