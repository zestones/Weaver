import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { ChangedFile } from '../../src/lib/git/tree-diff.ts'
import { OwnerDirectives } from '../../src/review/routing/owner-directives.ts'
import { ReviewRouting } from '../../src/review/routing/review-routing.ts'
import { UnitDiff } from '../../src/unit-of-work/diff/unit-diff.ts'
import { declarationOf } from '../fixtures/declaration.ts'

const policyOf = (review: Record<string, unknown>) => {
  const { review: policy } = declarationOf({ review })

  if (policy === null) throw new Error('a review is declared')

  return policy
}
const changed = (path: string, lines = 5, oldPath = path): ChangedFile => ({ status: 'M', path, oldPath, added: [[1, lines]] })
const diffOf = (files: ChangedFile[]) => new UnitDiff({ repo: null as never, dir: '', base: '', head: '', files, excluded: [] })
const assign = (review: Record<string, unknown>, author: string, files: ChangedFile[], requests: string[] = []) =>
  new ReviewRouting(policyOf(review), new OwnerDirectives(requests)).assign(author, diffOf(files))

test('the project names who reviews: a runtime, the one that wrote the change, or the one that did not, each with its model', () => {
  const reviewers = { claude: { model: 'opus', effort: 'max' }, codex: { model: 'gpt-6' } }
  const files = [changed('src/a.ts')]

  assert.deepEqual(assign({ runtime: 'codex', reviewers, timeoutSeconds: 60 }, 'claude', files), {
    runtime: 'codex',
    reason: 'the runtime the project names',
    model: 'gpt-6',
    effort: null,
    timeoutSeconds: 60,
    experiments: false,
  })
  assert.deepEqual(
    ['claude', 'codex'].map((author) => assign({ runtime: 'same', reviewers }, author, files).runtime),
    ['claude', 'codex'],
  )
  assert.deepEqual(
    ['claude', 'codex']
      .map((author) => assign({ runtime: 'other', reviewers, experiments: true }, author, files))
      .map((given) => [given.runtime, given.model, given.experiments]),
    [
      ['codex', 'gpt-6', true],
      ['claude', 'opus', true],
    ],
  )
})

test('where a mistake costs the most, the runtime that did not write the change reviews, whatever the project names', () => {
  const review = { runtime: 'same', critical: { paths: ['src/auth/**'], lines: 200 } }

  assert.deepEqual(
    [assign(review, 'claude', [changed('src/a.ts')]).runtime, assign(review, 'claude', [changed('src/a.ts')]).reason],
    ['claude', 'the runtime that wrote the change'],
  )
  assert.deepEqual(
    [assign(review, 'claude', [changed('src/auth/token.ts')]).runtime, assign(review, 'claude', [changed('src/auth/token.ts')]).reason],
    ['codex', 'critical path: src/auth/token.ts'],
  )
  assert.equal(
    assign(review, 'claude', [changed('src/token.ts', 5, 'src/auth/token.ts')]).reason,
    'critical path: src/auth/token.ts -> src/token.ts',
  )
  assert.equal(assign(review, 'codex', [changed('src/a.ts', 150), changed('src/b.ts', 51)]).reason, '201 changed lines, more than 200')
  assert.equal(assign(review, 'codex', [changed('src/a.ts', 200)]).runtime, 'codex')
})

test('the owner has the last word, in the request: #critical for the other runtime, #simple for the same', () => {
  const review = { runtime: 'codex', critical: { paths: ['src/auth/**'] } }
  const files = [changed('src/auth/token.ts')]

  assert.deepEqual(
    [
      assign(review, 'codex', [changed('src/a.ts')], ['rename it #critical']).runtime,
      assign(review, 'codex', [changed('src/a.ts')], ['rename it #critical']).reason,
    ],
    ['claude', '#critical in the request'],
  )
  assert.equal(assign(review, 'codex', files, ['a typo, #simple.']).runtime, 'codex')
  assert.equal(assign(review, 'codex', files, ['#simple', 'and now #critical']).runtime, 'claude')
})

test('a word that is almost a directive is named, with the one it was probably meant to be', () => {
  assert.deepEqual(new OwnerDirectives(['fix it #critcal, and #no-reveiw please']).problems(), [
    '#critcal is not a directive: did you mean #critical?',
    '#no-reveiw is not a directive: did you mean #no-review?',
  ])
  assert.deepEqual(new OwnerDirectives(['#critical #simple #no-review #review, in #fff on the #dashboard']).problems(), [])
})

test('#no-review asks for no review, unless a request of the same work asks for one; a colour or a word in a path is not a directive', () => {
  assert.equal(new OwnerDirectives(['fix the typo #no-review']).skipsReview, true)
  assert.equal(new OwnerDirectives(['fix the typo #NO-REVIEW.']).skipsReview, true)
  assert.equal(new OwnerDirectives(['fix the typo #no-review', 'in fact #review it']).skipsReview, false)
  assert.equal(new OwnerDirectives(['fix the typo #no-review', 'this is #critical']).skipsReview, false)
  assert.equal(new OwnerDirectives(['make it #fff and see docs/page#no-review']).skipsReview, false)
  assert.equal(new OwnerDirectives([]).skipsReview, false)
})
