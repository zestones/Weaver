import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import type { ChangedFile } from '../../src/lib/git/tree-diff.ts'
import { AnswerReader } from '../../src/review/findings/answer-reader.ts'
import { declarationOf } from '../fixtures/declaration.ts'
import { writeFiles } from '../fixtures/repo.ts'

const top = mkdtempSync(join(tmpdir(), 'weaver-answer-'))
const SOURCE = [
  'import { z } from "zod"',
  '',
  'export function read(raw: string) {',
  '  const user = JSON.parse(raw) as User',
  '  return user',
  '}',
  '',
  'const one = 1',
  'const two = 2',
  'const three = 3',
  'const four = 4',
  'export const untouched = 1',
]
const FILES: ChangedFile[] = [{ status: 'M', path: 'src/a.ts', oldPath: 'src/a.ts', added: [[3, 6]] }]
const { rules } = declarationOf({
  review: {
    runtime: 'codex',
    rules: { T10: 'External data is parsed, never cast.', BUG: { statement: 'The change has no defect.', evidence: true } },
  },
})
const finding = (fields: Record<string, unknown> = {}) => ({
  rule: 'T10',
  file: 'src/a.ts',
  line: 4,
  quote: 'const user = JSON.parse(raw) as User',
  problem: 'casts external data',
  suggestion: 'parse it with zod',
  evidence: null,
  ...fields,
})
const read = (findings: unknown[], more: Record<string, unknown> = {}) =>
  new AnswerReader(rules, FILES, top).read({ summary: 'Read the file.', findings, suspicions: [], experiments: [], ...more })

writeFiles(top, { 'src/a.ts': SOURCE.join('\n') })

afterAll(() => {
  rmSync(top, { recursive: true, force: true })
})

test('a finding on a line the unit changed is kept, under the name the unit knows its file by', () => {
  const answer = read([
    finding(),
    finding({
      rule: 'BUG',
      file: `${top}/src/a.ts`,
      line: null,
      quote: null,
      problem: 'throws on empty input',
      evidence: 'node -e ...: SyntaxError',
    }),
  ])

  assert.deepEqual(answer?.findings, [
    {
      rule: 'BUG',
      file: 'src/a.ts',
      message: 'throws on empty input',
      quote: null,
      suggestion: 'parse it with zod',
      evidence: 'node -e ...: SyntaxError',
    },
    {
      rule: 'T10',
      file: 'src/a.ts',
      line: 4,
      message: 'casts external data',
      quote: 'const user = JSON.parse(raw) as User',
      suggestion: 'parse it with zod',
      evidence: null,
    },
  ])
  assert.deepEqual([answer?.summary, answer?.dropped, answer?.truncated], ['Read the file.', [], 0], 'what needs an experiment comes first')
})

test('a line number that drifted is put back by the quote, and a finding nowhere near the change is dropped with why', () => {
  const drifted = read([finding({ line: 40 })])
  const elsewhere = read([finding({ line: 12, quote: 'export const untouched = 1' })])
  const near = read([finding({ line: 8, quote: 'nothing like it' })])

  assert.equal(drifted?.findings[0]?.line, 4)
  assert.equal(read([finding({ line: null })])?.findings[0]?.line, 4, 'a finding without a line is placed by its quote too')
  assert.deepEqual(
    [elsewhere?.findings, elsewhere?.dropped],
    [[], ['T10 src/a.ts:12: the unit changed no line there, and the quote matches none']],
  )
  assert.equal(near?.findings[0]?.line, 8, 'three lines away still points at the change')
})

test('what the reviewer was not asked is dropped with why: another rule, another file, a finding said twice, a finding with nothing in it', () => {
  const answer = read([
    finding({ rule: 'L1' }),
    finding({ file: 'src/elsewhere.ts' }),
    finding(),
    finding({ problem: 'the same place again' }),
    { rule: 'T10' },
  ])

  assert.equal(answer?.findings.length, 1)
  assert.deepEqual(answer?.dropped, [
    'L1 src/a.ts:4: a rule the reviewer was not given',
    'T10 src/elsewhere.ts:4: the unit did not change this file',
    'T10 src/a.ts:4: said twice',
    'a finding without its file or what is wrong',
  ])
})

test('a claim about what the code does, without the experiment that shows it, is a suspicion for the owner', () => {
  const answer = read([finding({ rule: 'BUG', problem: 'may throw on empty input' })], {
    suspicions: [{ file: null, note: 'the cache may be stale' }, { file: 'src/a.ts' }],
    experiments: [{ command: 'npm test', observed: '12 passed' }, { command: 'ls' }],
  })

  assert.deepEqual(answer?.findings, [])
  assert.deepEqual(answer?.suspicions, [
    { file: null, note: 'the cache may be stale' },
    { file: 'src/a.ts', note: 'may throw on empty input (BUG, without the experiment that shows it)' },
  ])
  assert.deepEqual(answer?.experiments, [{ command: 'npm test', observed: '12 passed' }])
})

test('the author reads eight findings at most, and the rest is counted; an answer without a list of findings is no answer', () => {
  const judgements = Array.from({ length: 9 }, (_, index) => finding({ line: index + 1, quote: null }))
  const defects = [1, 2].map((line) => finding({ rule: 'BUG', line, quote: null, evidence: 'ran it and saw it fail' }))
  const many = read([...judgements, ...defects])

  assert.deepEqual([many?.findings.length, many?.truncated], [8, 3])
  assert.deepEqual(
    many?.findings.slice(0, 3).map((kept) => kept.rule),
    ['BUG', 'BUG', 'T10'],
  )
  assert.equal(new AnswerReader(rules, FILES, top).read({ verdict: 'fine' }), null)
  assert.equal(new AnswerReader(rules, FILES, top).read('fine'), null)
})
