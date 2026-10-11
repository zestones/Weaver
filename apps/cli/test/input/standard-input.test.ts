import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { test } from 'vitest'

const SOURCE = join(import.meta.dirname, '../../src/input/standard-input.ts')
const PROBE = `import { StandardInput } from ${JSON.stringify(SOURCE)}; process.stdout.write(new StandardInput().read().toUpperCase())`

test('the standard input is read to its end, as a heredoc gives it', () => {
  const body = `Seen: a first line.\n${'Found: a long one. '.repeat(20_000)}\nDid: left as it is.\n`
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', PROBE], { input: body, encoding: 'utf8' })

  assert.equal(result.stdout, body.toUpperCase(), result.stderr)
  assert.equal(spawnSync(process.execPath, ['--input-type=module', '--eval', PROBE], { input: '', encoding: 'utf8' }).stdout, '')
})
