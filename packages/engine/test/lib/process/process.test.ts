import assert from 'node:assert/strict'
import { test } from 'vitest'
import { runProcess, TIMED_OUT } from '../../../src/lib/process/process.ts'

const MIB = 1024 * 1024
const OPTIONS = { cwd: process.cwd(), timeoutMs: 10_000 }
const print = (size: number): string => `process.stdout.write('x'.repeat(${String(size)}))`

test('the output of a command is cut at two MiB by default, and says so', async () => {
  const result = await runProcess(process.execPath, ['-e', print(3 * MIB)], OPTIONS)

  assert.equal(result.code, 0)
  assert.ok(result.output.length >= 2 * MIB && result.output.length < 3 * MIB)
  assert.match(result.output, /output cut at 2097152 bytes$/)
})

test('an explicit limit keeps the complete output of a real child process', async () => {
  const result = await runProcess(process.execPath, ['-e', print(3 * MIB)], { ...OPTIONS, outputLimit: 8 * MIB })

  assert.equal(result.output.length, 3 * MIB)
})

test('what a command prints on its error stream is kept out of its standard output', async () => {
  const result = await runProcess(process.execPath, ['-e', "console.error('noise'); console.log('answer')"], OPTIONS)

  assert.equal(result.stdout.trim(), 'answer')
  assert.match(result.output, /noise/)
})

test('a deadline kills the command and the processes it started, and reports 124', async () => {
  const started = Date.now()
  const result = await runProcess('sh', ['-c', 'sleep 30 & sleep 30'], { ...OPTIONS, timeoutMs: 300 })

  assert.equal(result.code, TIMED_OUT)
  assert.ok(Date.now() - started < 5000)
  assert.match(result.output, /stopped after 300 ms/)
})

test('a command that does not exist fails with the reason', async () => {
  const result = await runProcess('weaver-no-such-command', [], OPTIONS)

  assert.notEqual(result.code, 0)
  assert.match(result.output, /ENOENT/)
})
