import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { test } from 'vitest'
import { ConsoleOutput } from '../../src/output/console-output.ts'
import { Paint } from '../../src/output/paint.ts'

const TERMINAL = { isTTY: true }

test('what is said goes to the standard output, and what fails to the error stream', () => {
  const out = new PassThrough()
  const err = new PassThrough()
  const output = new ConsoleOutput(false, out, err, {})

  output.say('the answer')
  output.fail('what went wrong')

  assert.equal(String(out.read()), 'the answer\n')
  assert.equal(String(err.read()), 'what went wrong\n')
})

test('a reader that leaves early ends the output quietly; any other failure is still raised', () => {
  const stream = new PassThrough()
  const output = new ConsoleOutput(false, stream, new PassThrough(), {})

  output.say('first')
  stream.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
  output.say('second')

  assert.equal(String(stream.read()), 'first\n')
  assert.throws(() => stream.emit('error', Object.assign(new Error('no space left'), { code: 'ENOSPC' })), /no space left/)
})

test('colour is for a person at a terminal: a pipe, NO_COLOR, a dumb terminal or the owner asking turn it off', () => {
  const coloured = Paint.for(TERMINAL, {}, false)

  assert.equal(coloured.green('done'), '\u001B[32mdone\u001B[39m')
  assert.equal(coloured.bold('Runtimes'), '\u001B[1mRuntimes\u001B[22m')
  assert.equal(coloured.dim(''), '', 'nothing is wrapped around nothing')

  for (const plain of [
    Paint.for({ isTTY: false }, {}, false),
    Paint.for({}, {}, false),
    Paint.for(TERMINAL, { NO_COLOR: '1' }, false),
    Paint.for(TERMINAL, { TERM: 'dumb' }, false),
    Paint.for(TERMINAL, {}, true),
  ]) {
    assert.equal(plain.red('X'), 'X')
  }

  assert.equal(Paint.for(TERMINAL, { NO_COLOR: '' }, false).red('X'), '\u001B[31mX\u001B[39m', 'an empty NO_COLOR asks for nothing')
})

test('each stream is coloured or not by itself', () => {
  const out = Object.assign(new PassThrough(), { isTTY: true })
  const output = new ConsoleOutput(false, out, new PassThrough(), {})

  assert.notEqual(output.paint.red('X'), 'X')
  assert.equal(output.failPaint.red('X'), 'X', 'the error stream goes to a file')
  assert.equal(new ConsoleOutput(true, out, new PassThrough(), {}).paint.red('X'), 'X')
})
