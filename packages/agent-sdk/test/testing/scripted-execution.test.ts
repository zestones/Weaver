import assert from 'node:assert/strict'
import { test } from 'vitest'
import { AgentResult } from '../../src/ports/agent-result.ts'
import { AgentTask } from '../../src/ports/agent-task.ts'
import { ScriptedExecution } from '../../src/testing/scripted-execution.ts'

test('a scripted agent gives its answers in order, keeps the tasks it was given, and fails once it has none left', async () => {
  const agent = new ScriptedExecution('codex', [
    new AgentResult({ text: 'first', seconds: 1 }),
    new AgentResult({ text: 'second', seconds: 1 }),
  ])
  const task = new AgentTask({ prompt: 'review this', cwd: '/repo', access: 'read-only', timeoutSeconds: 60 })

  assert.equal((await agent.run(task)).text, 'first')
  assert.equal((await agent.run(task)).text, 'second')
  assert.equal((await agent.run(task)).failure, 'no scripted answer is left')
  assert.deepEqual(
    agent.tasks.map((given) => given.prompt),
    ['review this', 'review this', 'review this'],
  )
})

test('of the hooks of a folder, a scripted agent says what it was handed, and nothing by default', async () => {
  const held = { hooks: [{ command: 'hook Stop', standing: 'waits' as const }], failure: null }

  assert.equal(await new ScriptedExecution('claude', []).hooks(), null)
  assert.equal(await new ScriptedExecution('codex', [], held).hooks(), held)
})
