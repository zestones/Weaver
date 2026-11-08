import assert from 'node:assert/strict'
import { test } from 'vitest'
import { CheckOutcome } from '../../src/checks/results/check-outcome.ts'
import { CheckCoverage } from '../../src/verdict/check-coverage.ts'

const passed = new CheckOutcome({ id: 'lint', rules: [], status: 'pass', blocking: false, ms: 1, output: '' })

test('coverage distinguishes unchecked work, skipped checks, reused results, and no in-scope changes', () => {
  assert.match(new CheckCoverage(0, [], 4250).description, /No checks are configured; nothing was checked/)
  assert.match(new CheckCoverage(1, [new CheckOutcome({ ...passed, status: 'skip' })], 1).description, /All checks were skipped/)
  assert.match(new CheckCoverage(1, [new CheckOutcome({ ...passed, keptFrom: 'earlier' })], 1).description, /results were reused/)
  assert.match(new CheckCoverage(0, [], 0).description, /No in-scope file changed/)
  assert.equal(new CheckCoverage(1, [passed], 1).unchecked, false)
})
