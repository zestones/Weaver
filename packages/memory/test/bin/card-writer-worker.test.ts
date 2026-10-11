import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'
import { afterAll, test } from 'vitest'
import { CardRegistry } from '../../src/registry/card-registry.ts'
import { DetachedWriterLauncher } from '../../src/writing/launching/detached-writer-launcher.ts'
import type { WriterJob } from '../../src/writing/request/writer-job.ts'
import { flagOf } from '../fixtures/cards.ts'

interface Seen {
  readonly cwd: string
  readonly marked: string | null
  readonly argv: readonly string[]
}

const scratch = mkdtempSync(join(tmpdir(), 'weaver-memory-worker-'))
const WORKER = join(import.meta.dirname, '../../src/bin/card-writer-worker.ts')
const top = join(scratch, 'project')
const seenAt = join(scratch, 'seen.json')
// Stands for the command line of Claude Code: it writes one card for each flag the prompt holds.
const CLAUDE = `#!/usr/bin/env node
let asked = ''
process.stdin.on('data', (chunk) => { asked += chunk })
process.stdin.on('end', () => {
  const cards = [...asked.matchAll(/### Flag #(\\d+)/g)].map(([, flag]) => ({
    flag: Number(flag),
    title: 'Written by the worker',
    labels: [],
    sections: [{ name: 'Observation', text: 'Seen.' }],
    look: { verdict: 'cannot-tell', note: 'Read nothing.' },
    sameAs: null,
    sure: false,
    sameNote: null,
  }))
  const seen = { cwd: process.cwd(), marked: process.env.WEAVER_WRITER ?? null, argv: process.argv.slice(2) }
  require('node:fs').writeFileSync(${JSON.stringify(seenAt)}, JSON.stringify(seen))
  console.log(JSON.stringify({ result: '', is_error: false, total_cost_usd: 0.01, structured_output: { cards } }))
})
`
const PATH = [join(scratch, 'bin'), process.env.PATH ?? ''].join(delimiter)
let folders = 0

function jobOn(stateDir: string): WriterJob {
  return {
    top,
    stateDir,
    settings: { runtime: 'claude', model: null, effort: null, timeoutSeconds: 30, skill: null, sections: ['Observation'] },
    labels: {},
    environment: { WEAVER_WRITER: '1' },
  }
}

// A registry with one raw flag, in a state folder of its own.
function flagged(): { stateDir: string; registry: CardRegistry } {
  const stateDir = join(scratch, `state-${String(++folders)}`)
  const registry = new CardRegistry(stateDir)

  registry.flag(flagOf())

  return { stateDir, registry }
}

async function until(done: () => boolean): Promise<void> {
  for (let waited = 0; !done() && waited < 20_000; waited += 50) await sleep(50)
}

mkdirSync(join(scratch, 'bin'))
mkdirSync(top)
writeFileSync(join(scratch, 'bin', 'claude'), CLAUDE)
chmodSync(join(scratch, 'bin', 'claude'), 0o755)

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

test('the worker is given a job, writes up the flags that wait in its registry with a real runtime, and prints nothing', async () => {
  const { stateDir, registry } = flagged()
  const printed = await promisify(execFile)(process.execPath, [WORKER, JSON.stringify(jobOn(stateDir))], { env: { ...process.env, PATH } })
  const card = registry.find(1)
  const seen = JSON.parse(readFileSync(seenAt, 'utf8')) as Seen

  assert.deepEqual([printed.stdout, printed.stderr], ['', ''])
  assert.deepEqual([card?.state, card?.title], ['open', 'Written by the worker'])
  assert.deepEqual(card?.record.written?.writer.runtime, 'claude')
  assert.deepEqual([seen.cwd, seen.marked], [top, '1'])
  assert.deepEqual(
    seen.argv.slice(seen.argv.indexOf('--allowedTools')),
    ['--allowedTools', 'Read', 'Grep', 'Glob'],
    'the writer only reads',
  )
  assert.equal(registry.takeWriterTurn(process.pid), true, 'the worker left its turn')
  registry.close()
})

test('a worker that cannot read its job ends in failure, and still prints nothing', async () => {
  const failed = await promisify(execFile)(process.execPath, [WORKER, 'not a job']).then(
    () => null,
    (error: { code: number; stdout: string; stderr: string }) => error,
  )

  assert.deepEqual([failed?.code, failed?.stdout, failed?.stderr], [1, '', ''])
})

test('the launcher starts the worker of this package in a process of its own, and comes back before it is done', async () => {
  const { stateDir, registry } = flagged()
  const before = process.env.PATH

  process.env.PATH = PATH

  try {
    new DetachedWriterLauncher().start(jobOn(stateDir))
  } finally {
    process.env.PATH = before
  }

  assert.equal(registry.find(1)?.state, 'raw', 'the launcher did not wait for the card')

  await until(() => registry.find(1)?.state === 'open')
  await until(() => registry.takeWriterTurn(process.pid))

  assert.deepEqual([registry.find(1)?.state, registry.find(1)?.title], ['open', 'Written by the worker'])
  registry.close()
})

test('a launcher whose worker is not there says nothing, and the flags stay raw', async () => {
  const { stateDir, registry } = flagged()

  new DetachedWriterLauncher(join(scratch, 'no-such-worker.js')).start(jobOn(stateDir))
  await sleep(300)

  assert.equal(registry.find(1)?.state, 'raw')
  registry.close()
})
