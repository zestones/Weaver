import assert from 'node:assert/strict'
import { test } from 'vitest'
import { DrawnCode } from '../../src/markdown/drawn-code.ts'
import { Paint } from '../../src/output/paint.ts'

const plain = new Paint(false)

test('a block of code is brought back to the margin behind a bar, and a long line goes on under the bar', () => {
  const code = ['        if stale:', '', '            refresh(token)  # a comment that runs past the edge', '        return token'].join(
    '\n',
  )

  assert.deepEqual(new DrawnCode(plain, 30).block(code, 'python'), [
    '  │ if stale:',
    '  │',
    '  │     refresh(token)  # a',
    '  │ comment that runs past',
    '  │ the edge',
    '  │ return token',
  ])
  assert.deepEqual(
    new DrawnCode(plain, 80).block('\ta = 1\n\t\tb = 2', ''),
    ['  │ a = 1', '  │   b = 2'],
    'a tab is drawn as wide as a step',
  )
})

test('an excerpt of a file keeps its line numbers, and points at the line that matters', () => {
  const lines = [
    { number: 9, text: '  try {' },
    { number: 10, text: '    return cached // the value nobody ever renews' },
    { number: 11, text: '  }' },
  ]

  assert.deepEqual(new DrawnCode(plain, 32).excerpt(lines, 'typescript', 10), [
    '   9 │ try {',
    '▸ 10 │   return cached // the',
    '     │ value nobody ever renews',
    '  11 │ }',
  ])
  assert.deepEqual(new DrawnCode(new Paint(true), 80).excerpt([{ number: 7, text: 'return 1' }], 'typescript', 7), [
    '\u001B[33m▸\u001B[39m \u001B[1m7\u001B[22m \u001B[90m│\u001B[39m \u001B[35mreturn\u001B[39m \u001B[33m1\u001B[39m',
  ])
  assert.deepEqual(new DrawnCode(plain, 80).excerpt(lines.slice(0, 1), 'typescript', null), ['  9 │ try {'])
})

test('the language of a file is told from how its name ends', () => {
  assert.equal(DrawnCode.languageOf('platform/api/app.py'), 'python')
  assert.equal(DrawnCode.languageOf('src/auth/token.tsx'), 'typescript')
  assert.equal(DrawnCode.languageOf('db/episodes.sql'), 'sql')
  assert.equal(DrawnCode.languageOf('Makefile'), '')
})
