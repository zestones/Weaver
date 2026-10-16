import assert from 'node:assert/strict'
import { test } from 'vitest'
import { ValidationList, type ValidationItem } from '../../src/verdict/validation-list.ts'

const MIGRATION = 'migrations/versions/020_oee.up.sql'
const TESTS = 'tests/test_production_downtime.py'
const CHANGED = 'existing assertions or their inputs changed; verify the agreed behaviour'

test('a file named by several checks, rules and guards is one entry, with every reason it waits under it', () => {
  const list = new ValidationList([
    {
      file: MIGRATION,
      rule: 'protected-files-flagged',
      line: null,
      message: 'the guard protected-files keeps agents from writing migrations/**',
    },
    {
      file: MIGRATION,
      rule: 'backend-schema-changes-flagged',
      line: 1,
      message: '[B11-schema-owner] a schema change is the owner’s decision',
    },
    { file: TESTS, rule: 'backend-tests-flagged', line: 111, message: `[B10-expected-owner] test_aggregates: ${CHANGED}` },
    { file: MIGRATION, rule: 'weaver:maintenance', line: null, message: 'written, which the guard protected-files refuses' },
    { file: TESTS, rule: 'backend-tests-flagged', line: 142, message: `[B10-expected-owner] test_measured_basis: ${CHANGED}` },
    { file: null, rule: 'weaver:declaration', line: null, message: '.weaver: the unit changed the project’s declaration' },
  ])

  assert.equal(list.entries.length, 3)
  assert.deepEqual(list.lines(), [
    `- ${MIGRATION}`,
    '  - protected-files-flagged, the guard protected-files keeps agents from writing migrations/**',
    '  - backend-schema-changes-flagged, line 1: [B11-schema-owner] a schema change is the owner’s decision',
    '  - weaver:maintenance, written, which the guard protected-files refuses',
    `- ${TESTS}`,
    `  - backend-tests-flagged, 2 places: ${CHANGED} ([B10-expected-owner] test_aggregates, [B10-expected-owner] test_measured_basis)`,
    '- weaver:declaration, .weaver: the unit changed the project’s declaration',
  ])
})

test('places a rule names in different words stay apart', () => {
  const list = new ValidationList([
    { file: TESTS, rule: 'M2', line: 1, message: 'lint suppression added' },
    { file: TESTS, rule: 'M2', line: 9, message: 'another suppression: of a type check' },
  ])

  assert.deepEqual(list.lines(), [
    `- ${TESTS}`,
    '  - M2, line 1: lint suppression added',
    '  - M2, line 9: another suppression: of a type check',
  ])
})

test('files that wait for the same reasons are one entry, named from the folder they share', () => {
  const FUNCTIONS = 'migrations/functions'
  const guarded = (file: string): ValidationItem[] => [
    { file, rule: 'protected-files-flagged', line: null, message: 'the guard protected-files keeps agents from writing migrations/**' },
    { file, rule: 'backend-schema-changes-flagged', line: 1, message: '[B11-schema-owner] a schema change is the owner’s decision' },
  ]
  const list = new ValidationList([
    ...guarded(`${FUNCTIONS}/012_reliability/fn_mtbf.sql`),
    { file: TESTS, rule: 'backend-tests-flagged', line: 111, message: `[B10-expected-owner] test_aggregates: ${CHANGED}` },
    ...guarded(`${FUNCTIONS}/reliability/fn_mtbf.sql`),
    ...guarded(`${FUNCTIONS}/coverage/fn_trusted_now.sql`),
    {
      file: 'README.md',
      rule: 'protected-files-flagged',
      line: null,
      message: 'the guard protected-files keeps agents from writing migrations/**',
    },
  ])

  assert.equal(list.entries.length, 3)
  assert.equal(list.count, 5)
  assert.deepEqual(list.lines().slice(0, 3), [
    `- 3 files under ${FUNCTIONS}/: 012_reliability/fn_mtbf.sql, reliability/fn_mtbf.sql, coverage/fn_trusted_now.sql`,
    '  - protected-files-flagged, the guard protected-files keeps agents from writing migrations/**',
    '  - backend-schema-changes-flagged, line 1: [B11-schema-owner] a schema change is the owner’s decision',
  ])
  assert.equal(list.lines().at(-2), '- README.md')
})
