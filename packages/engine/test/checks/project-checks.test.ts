import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import type { CheckOutcome } from '../../src/checks/results/check-outcome.ts'
import { ProjectChecks } from '../../src/checks/running/project-checks.ts'
import { DeclarationFile } from '../../src/declaration/reading/declaration-file.ts'
import type { Repository } from '../../src/lib/git/repository.ts'
import { TreeDiff } from '../../src/lib/git/tree-diff.ts'
import { WorkingTreeSnapshot } from '../../src/lib/git/working-tree-snapshot.ts'
import { UnitDiff } from '../../src/unit-of-work/diff/unit-diff.ts'
import { Session } from '../../src/unit-of-work/session/session.ts'
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

async function run(declaration: Record<string, unknown>): Promise<Record<string, CheckOutcome>> {
  const project = new DeclarationFile('weaver.json').parse(JSON.stringify({ version: 1, ...declaration }))
  const { dir } = new Session(repo, 's', 'claude')
  const base = git(repo.top, ['rev-parse', 'HEAD^{tree}'])
  const head = new WorkingTreeSnapshot(repo, dir).tree()
  const files = new TreeDiff(repo, base, head).files([])
  const outcomes = await new ProjectChecks().run(project, new UnitDiff({ repo, dir, base, head, files, excluded: [] }))

  return Object.fromEntries(outcomes.map((outcome) => [outcome.id, outcome]))
}

const gate = (check: string) => ({ level: 'gate', statement: 'A program settles it.', check })
const human = (check: string) => ({ level: 'human', statement: 'The owner settles it.', check })

test('the exit status of a check is its verdict, and its rules say whether a failure blocks', async () => {
  writeFiles(repo.top, { 'src/a.js': 'export const a = 2\n' })

  const outcomes = await run({
    checks: { ok: { run: ['true'] }, broken: { run: ['sh', '-c', 'echo boom >&2; exit 3'] }, advisory: { run: ['false'] } },
    rules: { G1: gate('ok'), G2: gate('broken'), H1: human('advisory') },
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
      names: { run: ['sh', '-c', 'echo "$@"; exit 1', 'sh', '{files}'], when: ['src/**/*.js'], cwd: 'src' },
      sql: { run: ['false'], when: ['**/*.sql'] },
      docs: { run: ['false', '{files}'], when: ['docs/**'] },
    },
    rules: { G1: gate('names'), G2: gate('sql'), G3: gate('docs') },
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
      mixed: { run: reporter(findings), reads: 'findings' },
      advisory: { run: reporter({ findings: [findings.findings[1]] }), reads: 'findings' },
    },
    rules: { M1: gate('mixed'), M2: human('mixed'), M3: human('advisory') },
  })

  assert.deepEqual([outcomes.mixed?.status, outcomes.mixed?.blocking], ['fail', true])
  assert.deepEqual(outcomes.mixed?.failures, [findings.findings[0]])
  assert.deepEqual(outcomes.mixed?.toValidate, [findings.findings[1]])
  assert.equal(outcomes.advisory?.reason, 'a finding names M2, a rule this check does not stand behind')
})

test('findings only the owner settles pass the check and wait for them', async () => {
  writeFiles(repo.top, { 'src/a.js': 'export const a = 2\n' })

  const finding = { rule: 'M2', file: 'src/a.js', message: 'eslint-disable added' }
  const outcomes = await run({ checks: { c: { run: reporter({ findings: [finding] }), reads: 'findings' } }, rules: { M2: human('c') } })

  assert.deepEqual([outcomes.c?.status, outcomes.c?.blocking, outcomes.c?.toValidate], ['pass', false, [finding]])
})

test('a check that cannot give its verdict fails: no output, no JSON, a crash or a missing program', async () => {
  writeFiles(repo.top, { 'src/a.js': 'export const a = 2\n' })

  const outcomes = await run({
    checks: {
      silent: { run: ['true'], reads: 'findings' },
      shapeless: { run: reporter({ findings: [{ rule: 'G2' }] }), reads: 'findings' },
      crashed: { run: reporter({ findings: [] }, 2), reads: 'findings' },
      missing: { run: ['weaver-no-such-command'] },
    },
    rules: { G1: gate('silent'), G2: gate('shapeless'), G3: gate('crashed'), G4: gate('missing') },
  })

  for (const id of ['silent', 'shapeless', 'crashed', 'missing'])
    assert.deepEqual([id, outcomes[id]?.status, outcomes[id]?.blocking], [id, 'fail', true])

  assert.equal(outcomes.silent?.reason, 'the check did not print its findings as JSON on its last line')
  assert.equal(outcomes.crashed?.reason, 'the check exited with 2')
  assert.match(outcomes.missing?.output ?? '', /ENOENT/)
})

test('a check that outlives its deadline times out, and the check that reads its output does not run', async () => {
  writeFiles(repo.top, { 'src/a.js': 'export const a = 2\n' })

  const outcomes = await run({
    checks: { reader: { run: ['true'], after: 'slow' }, slow: { run: ['sleep', '30'], timeoutSeconds: 1 } },
    rules: { G1: gate('reader'), G2: gate('slow') },
  })

  assert.deepEqual([outcomes.slow?.status, outcomes.slow?.blocking], ['timeout', true])
  assert.deepEqual([outcomes.reader?.status, outcomes.reader?.reason], ['skip', 'slow did not finish'])
})

test('a check is told the two trees and reads the diff of the unit as a file, added lines included', async () => {
  writeFiles(repo.top, { 'src/a.js': 'export const a = 1\nexport const b = 2\n' })

  const script =
    "const diff = JSON.parse(require('fs').readFileSync(process.env.WEAVER_UNIT_DIFF)); console.log(JSON.stringify([diff, process.env.WEAVER_BASE_TREE, process.env.WEAVER_HEAD_TREE]))"
  const outcomes = await run({ checks: { c: { run: ['node', '-e', script] } }, rules: { G1: gate('c') } })
  const [diff, base, head] = JSON.parse(outcomes.c?.output ?? '') as [unknown, string, string]

  assert.deepEqual(diff, [{ status: 'M', path: 'src/a.js', oldPath: 'src/a.js', added: [[2, 2]] }])
  assert.equal(base, git(repo.top, ['rev-parse', 'HEAD^{tree}']))
  assert.match(head, /^[0-9a-f]{40}$/)
})

test('checks that wait for each other in a loop are reported, never waited for', async () => {
  writeFiles(repo.top, { 'src/a.js': 'export const a = 2\n' })

  const outcomes = await run({
    checks: { one: { run: ['true'], after: 'two' }, two: { run: ['true'], after: 'one' } },
    rules: { G1: gate('one'), G2: gate('two') },
  })

  assert.equal(outcomes.one?.reason, 'the check never started: its `after` chain loops')
  assert.equal(outcomes.two?.blocking, true)
})
