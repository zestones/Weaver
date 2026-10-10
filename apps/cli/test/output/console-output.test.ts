import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { test } from 'vitest'
import { ConsoleOutput } from '../../src/output/console-output.ts'

test('a reader that leaves early ends the output quietly; any other failure is still raised', () => {
  const stream = new PassThrough()
  const output = new ConsoleOutput(stream)

  output.say('first')
  stream.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
  output.say('second')

  assert.equal(String(stream.read()), 'first\n')
  assert.throws(() => stream.emit('error', Object.assign(new Error('no space left'), { code: 'ENOSPC' })), /no space left/)
})
