import assert from 'node:assert/strict'
import { test } from 'vitest'
import { patchedFiles, patchedPaths } from '../../../src/lib/text/patch.ts'

const PATCH = [
  '*** Begin Patch',
  '*** Add File: src/new.ts',
  '+export const a = 1',
  '*** Delete File: src/old.ts',
  '*** Update File: src/app.ts',
  '*** Move to: src/main.ts',
  '@@ export function main() {',
  '-  return 1',
  '+  return 2',
  '*** End Patch',
].join('\n')

test('a patch names the files it adds, deletes, updates and moves', () => {
  assert.deepEqual(
    patchedFiles(PATCH).map((file) => [file.op, file.path, file.movePath]),
    [
      ['add', 'src/new.ts', null],
      ['delete', 'src/old.ts', null],
      ['update', 'src/app.ts', 'src/main.ts'],
    ],
  )
})

test('every path a patch touches is resolved from where it runs, a moved file at both ends', () => {
  assert.deepEqual(patchedPaths(PATCH, '/repo'), ['/repo/src/new.ts', '/repo/src/old.ts', '/repo/src/app.ts', '/repo/src/main.ts'])
  assert.deepEqual(patchedPaths('*** Begin Patch\n*** Add File: /tmp/x.ts\n+x\n*** End Patch', '/repo'), ['/tmp/x.ts'])
})

test('a heredoc around the patch is tolerated, and text without a patch names nothing', () => {
  assert.equal(patchedFiles("<<'EOF'\n*** Begin Patch\n*** Add File: a.ts\n+x\n*** End Patch\nEOF\n")[0]?.path, 'a.ts')
  assert.deepEqual(patchedFiles('echo hello'), [])
})
