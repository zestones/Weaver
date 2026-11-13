import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { Repository } from '../../src/lib/git/repository.ts'
import { UnitDiff } from '../../src/unit-of-work/diff/unit-diff.ts'
import { UnitOfWork } from '../../src/unit-of-work/unit/unit-of-work.ts'
import { Report } from '../../src/verdict/report.ts'
import { UnitVerdict } from '../../src/verdict/unit-verdict.ts'
import { declaration } from '../fixtures/session.ts'

const dir = mkdtempSync(join(tmpdir(), 'weaver-capped-verdict-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('a capped verdict names unvalidated checks and retains the earlier report without claiming a pass', () => {
  const failed = UnitOfWork.fresh(1).withFailedRound()
  const unit = new UnitOfWork({
    ...failed.record,
    check: { ...failed.record.check, judged: { key: 'previous', report: '0001-unit-1-round-1.md' } },
  })
  const diff = new UnitDiff({
    repo: new Repository(dir, join(dir, '.git'), join(dir, '.git')),
    dir,
    base: 'base',
    head: 'head',
    files: [{ path: 'a.ts', oldPath: 'a.ts', status: 'M', added: [[1, 2]] }],
    excluded: [],
  })
  const verdict = new UnitVerdict({ unit, maxRefusals: 1, diff, outcomes: [], repaired: [], review: null, ms: 1, deferredChecks: ['lint'] })
  const report = new Report(declaration(), verdict)
  const path = report.write(dir)
  const text = readFileSync(path, 'utf8')
  assert.equal(verdict.passed, false)
  assert.equal(verdict.round, 1)
  assert.match(text, /round 1: Checks not re-run after the refusal cap/)
  assert.match(text, /## To validate[^]*Checks not re-run after 1 refusal; left to the owner: lint/)
  assert.match(text, /last check report\]\(0001-unit-1-round-1.md\); they were not revalidated at this end of turn/)
  assert.match(report.summary(path), /without renewed automated validation/)
  assert.doesNotMatch(text + report.summary(path), /checks? passed|configure \.weaver/)
  assert.deepEqual(verdict.event(), {
    kind: 'check',
    unit: 1,
    round: 1,
    passed: false,
    afterCap: true,
    failed: [],
    toValidate: 1,
    files: 1,
    lines: 2,
    repaired: 0,
    ms: 1,
    checks: [],
  })
})
