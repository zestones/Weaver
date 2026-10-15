import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterAll, test } from 'vitest'
import { DetachedLauncher } from '../../src/review/launching/detached-launcher.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-launcher-'))

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

test('the review runs in a process that is no child of the hook, which a runtime ends with all its descendants when it cancels it', async () => {
  const seen = join(scratch, 'seen.json')

  writeFileSync(
    join(scratch, 'review-worker.js'),
    `require('node:fs').writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ parent: process.ppid, args: process.argv.slice(2) }))\n`,
  )
  new DetachedLauncher(join(scratch, 'hook.js')).start({ top: '/project' } as never, '/session', 'f00d')

  for (let tries = 0; tries < 100 && !existsSync(seen); tries += 1) await sleep(50)

  const worker = JSON.parse(readFileSync(seen, 'utf8')) as { parent: number; args: string[] }

  assert.deepEqual(worker.args, ['/project', '/session', 'f00d'])
  assert.notEqual(worker.parent, process.pid)
})
