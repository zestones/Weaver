import assert from 'node:assert/strict'
import { test } from 'vitest'
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
