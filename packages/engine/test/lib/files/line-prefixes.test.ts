import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
import { linePrefixes } from '../../../src/lib/files/line-prefixes.ts'

test('line prefixes skip huge lines and preserve UTF-8 and headers across read boundaries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'weaver-prefixes-'))
  try {
    const path = join(dir, 'patch')
    writeFileSync(path, `${'x'.repeat(65_534)}\néclair\n${'y'.repeat(200_000)}\n@@ -1 +2 @@`)
    assert.deepEqual([...linePrefixes(path, 20)], ['x'.repeat(20), 'éclair', 'y'.repeat(20), '@@ -1 +2 @@'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
