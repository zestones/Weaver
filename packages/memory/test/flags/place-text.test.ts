import assert from 'node:assert/strict'
import { test } from 'vitest'
import { PlaceText } from '../../src/flags/place-text.ts'

const read = (text: string): [string, number | null] => {
  const place = new PlaceText(text)

  return [place.path, place.line]
}

test('a place is a path, with its line when it gives one', () => {
  assert.deepEqual(read('src/auth/token.ts'), ['src/auth/token.ts', null])
  assert.deepEqual(read('src/auth/token.ts:42'), ['src/auth/token.ts', 42])
  assert.deepEqual(read('  ./src/a.ts:7 '), ['./src/a.ts', 7])
})

test('the path is kept as written: resolving it is left to the caller', () => {
  assert.deepEqual(read('../other/a.ts:3'), ['../other/a.ts', 3])
  assert.deepEqual(read('/abs/a.ts'), ['/abs/a.ts', null])
  assert.deepEqual(read('a file.md:2'), ['a file.md', 2])
})

test('a place that points at a column or at a range of lines is its first line', () => {
  assert.deepEqual(read('src/a.ts:12:5'), ['src/a.ts', 12])
  assert.deepEqual(read('src/a.ts:12-20'), ['src/a.ts', 12])
})

test('what follows the path and is not a line number belongs to the path, and line 0 is no line', () => {
  assert.deepEqual(read('src/a.ts:end'), ['src/a.ts:end', null])
  assert.deepEqual(read('src/a.ts:'), ['src/a.ts:', null])
  assert.deepEqual(read('src/a.ts:0'), ['src/a.ts', null])
})

test('a place is written back as an agent writes it', () => {
  assert.equal(PlaceText.write({ file: 'src/a.ts', line: 42 }), 'src/a.ts:42')
  assert.equal(PlaceText.write({ file: 'src/a.ts', line: null }), 'src/a.ts')
})
