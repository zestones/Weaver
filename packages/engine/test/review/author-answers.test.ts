import assert from 'node:assert/strict'
import { test } from 'vitest'
import { AuthorAnswers } from '../../src/review/answers/author-answers.ts'
import type { ReviewFinding } from '../../src/review/findings/review-finding.ts'

const finding = (file: string): ReviewFinding => ({
  rule: 'T10',
  file,
  line: 1,
  message: 'm',
  quote: null,
  suggestion: null,
  evidence: null,
})
const FINDINGS = [finding('src/a.ts'), finding('src/b.ts'), finding('src/c.ts')]
const NONE = { unchanged: new Set<string>(), changed: [] }

test('the author answers each finding on a line of its final message, however it dresses the line', () => {
  const answers = new AuthorAnswers(
    [
      '## Request',
      '',
      'Done.',
      '- **F1** fixed: parsed the response with zod',
      'F2 not fixed — the owner asked for this cast',
      '`F3`: Not-Fixed. out of the scope of the request',
    ].join('\n'),
  )

  assert.deepEqual(answers.taken(FINDINGS, NONE), [
    { finding: 1, status: 'fixed', why: 'parsed the response with zod' },
    { finding: 2, status: 'not-fixed', why: 'the owner asked for this cast' },
    { finding: 3, status: 'not-fixed', why: 'out of the scope of the request' },
  ])
  assert.deepEqual(answers.problems(FINDINGS, NONE), [])
})

test('an answer is not taken when it is missing, says nothing, or says fixed of a file that did not change', () => {
  const answers = new AuthorAnswers('F1 fixed: parsed the response with zod\nF2 not fixed: no\nThe finding F3 is wrong.')
  const since = { unchanged: new Set(['src/a.ts']), changed: ['src/b.ts'] }

  assert.deepEqual(answers.problems(FINDINGS, since), [
    'F1 is answered fixed, and src/a.ts has not changed since the review: nothing is fixed yet. A fix made in another file is taken when the answer names that file',
    'F2: say what you changed, or why the finding does not hold',
    'F3 has no answer',
  ])
  assert.deepEqual(answers.taken(FINDINGS, since), [])
  assert.deepEqual(new AuthorAnswers(null).problems(FINDINGS.slice(0, 1), NONE), ['F1 has no answer'])
})

test('a finding fixed in another file than the one it is about is taken when the answer names a file that changed', () => {
  const since = { unchanged: new Set(['src/a.ts']), changed: ['test/a.test.ts', 'src/b.ts'] }
  const byPath = new AuthorAnswers('F1 fixed: test/a.test.ts asserts the plan keeps the call inlined')
  const byName = new AuthorAnswers('F1 fixed: added a.test.ts, which fails when the function is not inlined')
  const unnamed = new AuthorAnswers('F1 fixed: added a test that fails when the function is not inlined')

  assert.deepEqual(byPath.problems(FINDINGS.slice(0, 1), since), [])
  assert.deepEqual(byName.taken(FINDINGS.slice(0, 1), since), [
    { finding: 1, status: 'fixed', why: 'added a.test.ts, which fails when the function is not inlined' },
  ])
  assert.equal(unnamed.problems(FINDINGS.slice(0, 1), since).length, 1)
})
