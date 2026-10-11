import assert from 'node:assert/strict'
import { test } from 'vitest'
import { numberedDiff } from '../../../src/lib/text/numbered-diff.ts'

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -10,3 +10,4 @@ export function read() {',
  ' const raw = load()',
  '-return raw',
  '+const user = parse(raw)',
  '+return user',
  ' }',
  '@@ -40 +41,0 @@',
  '-export const unused = 1',
  '\\ No newline at end of file',
].join('\n')

test('each line of a diff carries its number in the new file; a removed line has none, and headers stay as they are', () => {
  assert.deepEqual(numberedDiff(DIFF).split('\n'), [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -10,3 +10,4 @@ export function read() {',
    '   10   const raw = load()',
    '      - return raw',
    '   11 + const user = parse(raw)',
    '   12 + return user',
    '   13   }',
    '@@ -40 +41,0 @@',
    '      - export const unused = 1',
    '\\ No newline at end of file',
  ])
  assert.equal(numberedDiff(''), '')
})
