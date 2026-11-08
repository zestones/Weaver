import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { ReviewerLoop } from '../../src/loop/dispatch/reviewer-loop.ts'
import { declarationFiles } from '../fixtures/declaration.ts'
import { writeFiles } from '../fixtures/repo.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-reviewer-guards-'))
const project = join(scratch, 'project')
const copy = join(scratch, 'copy')

writeFiles(project, declarationFiles({ guards: { services: { statement: 'The owner starts services.', runs: ['make dev', 'pnpm dev'] } } }))
writeFiles(copy, declarationFiles({}))

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

for (const runtime of ['claude', 'codex']) {
  test(`${runtime} reviewers obey the original project guards even after changing cwd or copy policy`, () => {
    const loop = new ReviewerLoop(copy, project)
    const run = (command: string) =>
      loop.handle('PreToolUse', [`--agent=${runtime}`], JSON.stringify({ cwd: '/', tool_name: 'Bash', tool_input: { command } }))

    for (const command of ['make dev', 'cd /tmp && pnpm dev']) {
      const output = run(command).body?.hookSpecificOutput

      assert.ok(output !== undefined && 'permissionDecision' in output)
      assert.equal(output.permissionDecision, 'deny')
    }
    assert.equal(run('docker exec app npm test && curl localhost:3000 && psql -c "select 1"').body, null)
    assert.equal(run('docker compose up -d').body, null, 'Weaver refuses nothing of its own: the project decides')
  })

  test(`${runtime} reviewers are only kept in their copy when the project's declaration cannot be read`, () => {
    const loop = new ReviewerLoop(copy, join(scratch, 'missing'))
    const run = (command: string) =>
      loop.handle('PreToolUse', [`--agent=${runtime}`], JSON.stringify({ cwd: copy, tool_name: 'Bash', tool_input: { command } }))

    assert.equal(run('make dev').body, null)
    assert.match(run(`echo x > ${join(homedir(), 'weaver-outside.txt')}`).print(), /deny/)
  })
}
