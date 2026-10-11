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
