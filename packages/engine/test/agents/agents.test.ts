import assert from 'node:assert/strict'
import { test } from 'vitest'
import { AgentCatalog } from '../../src/agents/runtimes/agent-catalog.ts'
import { Payload } from '../../src/agents/events/payload.ts'
import { NO_HINTS } from '../../src/lib/shell/writes/hints.ts'
import { Loop } from '../../src/loop/dispatch/loop.ts'

const TOP = '/repo'
const catalog = new AgentCatalog()
const claude = catalog.fromArguments(['Stop', '--agent=claude'])
const codex = catalog.fromArguments(['Stop', '--agent=codex'])

const writesOf = (agent: typeof claude, tool: string, input: Record<string, unknown>, cwd = TOP) =>
  agent.read(new Payload({ cwd, tool_name: tool, tool_input: input })).call?.writes(TOP, NO_HINTS)

test('a hook command names its runtime, and Claude Code is the one assumed when it names none', () => {
  assert.equal(codex.name, 'codex')
  assert.equal(catalog.fromArguments(['Stop']).name, 'claude')
  assert.equal(catalog.fromArguments(['Stop', '--agent=other']).name, 'claude')
})

test('every event a runtime fires for Weaver is one the loop listens to, and its tools are those it reads', () => {
  const loop = new Loop()

  for (const agent of catalog.agents)
    assert.deepEqual(
      agent.events.filter((event) => !loop.handles(event)),
      [],
      agent.name,
    )

  assert.deepEqual(claude.tools, ['Bash', 'Monitor', 'PowerShell', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
  assert.deepEqual(codex.tools, ['Bash', 'Monitor', 'PowerShell', 'apply_patch'])
  assert.equal(codex.events.includes('PostToolUseFailure'), false)
})

test('an event is read into one shape whatever is missing from its payload', () => {
  const event = claude.read(new Payload({ session_id: 's', cwd: TOP, prompt: 'go', agent_id: 'sub', last_assistant_message: 'done' }))
  const empty = claude.read(Payload.parse(''))

  assert.deepEqual([event.sessionId, event.prompt, event.lastMessage, event.call], ['s', 'go', 'done', null])
  assert.deepEqual([event.agentId, event.subagent], ['sub', true], 'the subagent that made the call')
  assert.deepEqual([empty.sessionId, empty.callId, empty.agentId, empty.subagent, empty.cwd], [null, null, null, false, process.cwd()])
})

test('each of Claude Code’s editing tools names the one file it writes, relative to where the call runs', () => {
  assert.deepEqual(writesOf(claude, 'Write', { file_path: '/repo/src/a.ts', content: 'x' }), { targets: ['src/a.ts'], scope: 'all' })
  assert.deepEqual(writesOf(claude, 'Edit', { file_path: 'a.ts' }, '/repo/src'), { targets: ['src/a.ts'], scope: 'all' })
  assert.deepEqual(writesOf(claude, 'NotebookEdit', { notebook_path: '/repo/n.ipynb' }), { targets: ['n.ipynb'], scope: 'all' })
  assert.deepEqual(writesOf(claude, 'Write', { file_path: '/elsewhere/a.ts' }), { targets: [], scope: 'all' }, 'outside the repository')
})

test('Codex edits through one tool, whose patch names every file it writes, moves or removes', () => {
  const patch = '*** Begin Patch\n*** Update File: src/app.ts\n*** Move to: src/main.ts\n@@\n-a\n+b\n*** Delete File: old.ts\n*** End Patch'

  assert.deepEqual(writesOf(codex, 'apply_patch', { command: patch }), { targets: ['src/app.ts', 'src/main.ts', 'old.ts'], scope: 'all' })
  assert.equal(writesOf(claude, 'apply_patch', { command: patch }), null, 'not a tool of Claude Code')
  assert.equal(writesOf(codex, 'Write', { file_path: '/repo/a.ts' }), null, 'not a tool of Codex')
})

test('a shell command writes what its words say, or the files of the patch it carries', () => {
  const patch = "apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: src/new.ts\n+x\n*** End Patch\nEOF"

  assert.deepEqual(writesOf(claude, 'Bash', { command: 'echo x > src/b.ts' }), { targets: null, scope: ['src/b.ts'] })
  assert.deepEqual(writesOf(codex, 'Bash', { command: ['npx', 'prettier', '--write', '.'] }), { targets: null, scope: 'all' })
  assert.deepEqual(writesOf(codex, 'Bash', { command: patch }), { targets: ['src/new.ts'], scope: 'all' })
  assert.equal(writesOf(claude, 'Bash', { command: 'git status' }), null, 'a command that only reads')
})

test('a call that leaves its command running says so; a tool that writes no file writes nothing', () => {
  const background = (tool: string, input: Record<string, unknown>) =>
    claude.read(new Payload({ cwd: TOP, tool_name: tool, tool_input: input })).call?.background

  assert.equal(background('Bash', { command: 'npm run dev', run_in_background: true }), true)
  assert.equal(background('Monitor', { command: 'tail -f log' }), true)
  assert.equal(background('Bash', { command: 'npm test' }), false)
  assert.equal(writesOf(claude, 'Read', { file_path: '/repo/a.ts' }), null)
})
