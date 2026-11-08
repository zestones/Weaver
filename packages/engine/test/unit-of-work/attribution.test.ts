import assert from 'node:assert/strict'
import { test } from 'vitest'
import { inScope } from '../../src/lib/git/path-scope.ts'
import { Attribution } from '../../src/unit-of-work/attribution/attribution.ts'

test('a call is charged with all that changed, with nothing, or with the paths it names and what is under them', () => {
  const named = new Attribution(['src/b.ts', 'src/old'])

  assert.equal(new Attribution('all').charges('anything.ts'), true)
  assert.equal(new Attribution('none').charges('anything.ts'), false)
  assert.equal(named.charges('src/b.ts'), true)
  assert.equal(named.charges('src/old/x.ts'), true)
  assert.equal(named.charges('src/older.ts'), false)
  assert.equal(named.charges('src/other.ts'), false)
})

test('scope excludes a folder itself and its descendants, treating metacharacters literally', () => {
  assert.equal(inScope('.local', ['.local/']), false)
  assert.equal(inScope('.local/file', ['./.local']), false)
  assert.equal(inScope('.locality/file', ['.local']), true)
  assert.equal(inScope('cache[1]/file', ['cache[1]']), false)
  assert.equal(inScope('cache1/file', ['cache[1]']), true)
  assert.equal(inScope('anything', ['.']), false)
})
