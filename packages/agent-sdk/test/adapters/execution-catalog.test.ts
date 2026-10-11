import assert from 'node:assert/strict'
import { test } from 'vitest'
import { ExecutionCatalog } from '../../src/adapters/catalog/execution-catalog.ts'

test('the catalog knows the runtimes Weaver can ask, by name', () => {
  const catalog = new ExecutionCatalog()

  assert.equal(catalog.find('claude')?.runtime, 'claude')
  assert.equal(catalog.find('codex')?.runtime, 'codex')
  assert.equal(catalog.find('gemini'), null)
})
