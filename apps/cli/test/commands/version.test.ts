import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'vitest'
import { readJson, weaver } from '../fixtures/project.ts'

const PACKAGE = join(import.meta.dirname, '../..')

test('weaver says the version its manifest carries, under each name of the command and under an agent too', async () => {
  const { version } = readJson<{ version: string }>(PACKAGE, 'package.json')

  for (const word of ['version', '--version', '-v'])
    assert.deepEqual(await weaver(PACKAGE, [word]), { status: 0, lines: [`weaver ${version}`] })

  assert.deepEqual(await weaver(PACKAGE, ['version'], { under: 'codex' }), { status: 0, lines: [`weaver ${version}`] })
})
