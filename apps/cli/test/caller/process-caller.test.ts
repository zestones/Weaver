import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { ProcList } from '../../src/caller/proc-list.ts'
import { ProcessCaller } from '../../src/caller/process-caller.ts'
import type { ProcessList, RunningProcess } from '../../src/caller/process-list.ts'

type Row = readonly [pid: number, parent: number, name: string | null, ...command: string[]]

const SOURCES = join(import.meta.dirname, '../../src/caller')
const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-caller-'))

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

// Who runs a command started by the process 40, in a table of processes written by hand.
function callerIn(rows: readonly Row[]): string | null {
  const processes = new Map(rows.map(([pid, parent, name, ...command]): [number, RunningProcess] => [pid, { parent, name, command }]))
  const list: ProcessList = { find: (pid) => processes.get(pid) ?? null }

  return new ProcessCaller(list, 40).agent()
}

test('from a terminal of the owner’s, no agent runs the command', () => {
  assert.equal(
    callerIn([
      [40, 30, 'fish', 'fish'],
      [30, 20, 'foot', '/usr/bin/foot'],
      [20, 1, 'systemd', '/usr/lib/systemd/systemd', '--user'],
    ]),
    null,
  )
})

test('an agent among the ancestors is found by the name of its process, however far up', () => {
  assert.equal(
    callerIn([
      [40, 30, 'bash', '/bin/bash', '-c', 'weaver close 3 fixed'],
      [30, 20, 'claude', 'claude'],
      [20, 1, 'fish', 'fish'],
    ]),
    'claude',
  )
  assert.equal(
    callerIn([
      [40, 30, 'sh', 'sh', '-c', 'make close'],
      [30, 20, 'make', 'make', 'close'],
      [20, 10, 'bash', 'bash'],
      [10, 1, 'codex', '/home/owner/.codex/bin/codex', 'exec'],
    ]),
    'codex',
  )
})

test('a runtime that runs a file named after its version is found by the folder of its versions', () => {
  assert.equal(
    callerIn([
      [40, 30, 'bash', '/bin/bash', '-c', 'weaver check backend'],
      [30, 1, '2.1.301', '/home/owner/.local/share/claude/versions/2.1.301', '--session-id', '6863887f', '--resume'],
    ]),
    'claude',
  )
})

test('in the sandbox of Codex, where the runtime is the first process, it is found there', () => {
  assert.equal(
    callerIn([
      [40, 2, 'node', 'node', '/home/owner/.local/bin/weaver', 'flag'],
      [2, 1, 'bash', '/bin/bash', '-lc', 'weaver flag src/a.ts'],
      [1, 0, 'codex', 'codex-linux-sandbox', '--sandbox-policy-cwd', '/repo'],
    ]),
    'codex',
  )
})

test('a runtime that renamed its process, or that runs as a script of its interpreter, is still found', () => {
  assert.equal(callerIn([[40, 1, 'claude', '/home/owner/.local/share/claude/versions/2.1.296']]), 'claude')
  assert.equal(callerIn([[40, 1, null, '/Users/owner/.local/bin/claude', '--resume']]), 'claude')
  assert.equal(callerIn([[40, 1, 'node', 'node', '/usr/local/bin/codex', 'exec']]), 'codex')
  assert.equal(callerIn([[40, 1, 'MainThread', '/usr/bin/node', '/usr/lib/node_modules/@openai/codex/bin/codex.js']]), 'codex')
})

test('a word that only looks like an agent proves nothing', () => {
  assert.equal(callerIn([[40, 1, 'vim', 'vim', 'claude']]), null)
  assert.equal(callerIn([[40, 1, 'node', 'node', '/srv/claude-proxy.js', 'codex']]), null)
})

test('processes that cannot be read, or that loop, end the search without an agent', () => {
  assert.equal(callerIn([[40, 30, 'bash', 'bash']]), null)
  assert.equal(
    callerIn([
      [40, 30, 'bash', 'bash'],
      [30, 40, 'bash', 'bash'],
    ]),
    null,
  )
})

// A shell under the name of an agent stands for the agent: the command it starts reads its real ancestors.
test('the real processes are read, from /proc where there is one and from ps', () => {
  const probe = join(scratch, 'probe.ts')
  const codex = join(scratch, 'codex')

  symlinkSync('/bin/sh', codex)
  writeFileSync(
    probe,
    [
      `import { ProcessCaller } from ${JSON.stringify(join(SOURCES, 'process-caller.ts'))}`,
      `import { ProcList } from ${JSON.stringify(join(SOURCES, 'proc-list.ts'))}`,
      `import { PsList } from ${JSON.stringify(join(SOURCES, 'ps-list.ts'))}`,
      `const lists = { proc: new ProcList(), ps: new PsList() }`,
      `process.stdout.write(String(new ProcessCaller(lists[process.argv[2]]).agent()))`,
    ].join('\n'),
  )

  // The shell is given a second command, so that it stays the parent of the first instead of becoming it.
  const asked = (list: string) => spawnSync(codex, ['-c', `"$0" "$1" "$2"; exit $?`, process.execPath, probe, list], { encoding: 'utf8' })

  assert.equal(asked('ps').stdout, 'codex', asked('ps').stderr)
  if (ProcList.isThere) assert.equal(asked('proc').stdout, 'codex', asked('proc').stderr)
})
