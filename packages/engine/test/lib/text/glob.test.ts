import assert from 'node:assert/strict'
import { test } from 'vitest'
import { matchesAny } from '../../../src/lib/text/glob.ts'

test('`*` stays within a folder, `**/` crosses any number of them, none included', () => {
  assert.equal(matchesAny(['src/*.ts'], 'src/a.ts'), true)
  assert.equal(matchesAny(['src/*.ts'], 'src/deep/a.ts'), false)
  assert.equal(matchesAny(['src/**/*.ts'], 'src/a.ts'), true)
  assert.equal(matchesAny(['src/**/*.ts'], 'src/deep/er/a.ts'), true)
  assert.equal(matchesAny(['src/**'], 'src/deep/a.css'), true)
  assert.equal(matchesAny(['**/*.sql'], 'query.sql'), true)
})

test('a glob matches the whole path, and its dots are dots', () => {
  assert.equal(matchesAny(['src/a.ts'], 'src/axts'), false)
  assert.equal(matchesAny(['src'], 'src/a.ts'), false)
  assert.equal(matchesAny(['docs/**', 'src/**'], 'src/a.ts'), true)
  assert.equal(matchesAny([], 'src/a.ts'), false)
})
