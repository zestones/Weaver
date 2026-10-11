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
const NONE = new Set<string>()

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

  assert.deepEqual(answers.problems(FINDINGS, new Set(['src/a.ts'])), [
    'F1 is answered fixed, and src/a.ts has not changed since the review: nothing is fixed yet',
    'F2: say what you changed, or why the finding does not hold',
    'F3 has no answer',
  ])
  assert.deepEqual(answers.taken(FINDINGS, new Set(['src/a.ts'])), [])
  assert.deepEqual(new AuthorAnswers(null).problems(FINDINGS.slice(0, 1), NONE), ['F1 has no answer'])
})
