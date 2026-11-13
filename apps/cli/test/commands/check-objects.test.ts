import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Loop } from '@weaver/engine'
import { afterAll, test } from 'vitest'
import { makeProject, SETTINGS, weaver, writeConfig } from '../fixtures/project.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-check-objects-'))
const SCRIPT = `
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const env = { ...process.env, GIT_OBJECT_DIRECTORY: process.env.WEAVER_GIT_OBJECTS }
delete env.GIT_ALTERNATE_OBJECT_DIRECTORIES
const show = (object) => execFileSync('git', ['show', object], { encoding: 'utf8', env })
assert.equal(show(process.env.WEAVER_BASE_TREE + ':file.txt'), 'owner base\\n')
assert.equal(show(process.env.WEAVER_HEAD_TREE + ':file.txt'), 'agent change\\n')
assert.equal(show('HEAD:file.txt'), 'committed\\n')
`

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

for (const readOnly of [false, true]) {
  test(`weaver check resolves snapshot and repository objects using WEAVER_GIT_OBJECTS alone (read-only: ${String(readOnly)})`, async () => {
    const top = makeProject(join(scratch, String(readOnly)))
    writeConfig(top, {
      settings: SETTINGS,
      checks: {
        objects: {
          cwd: '.',
          reads: 'exit',
          timeoutSeconds: 30,
          judge: ['node', '-e', SCRIPT],
          rules: { O: 'The snapshot objects can be read.' },
        },
      },
    })
    const file = join(top, 'file.txt')
    writeFileSync(file, 'committed\n')
    execFileSync('git', ['-C', top, 'add', '-A'])
    execFileSync('git', ['-C', top, '-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-qm', 'initial'])
    writeFileSync(file, 'owner base\n')
    const hook = (event: string, payload: object) =>
      new Loop().handle(event, ['--agent=claude'], JSON.stringify({ cwd: top, session_id: 'objects', ...payload }))
    await hook('UserPromptSubmit', { prompt: 'change the file' })
    const call = { tool_name: 'Write', tool_input: { file_path: file }, tool_use_id: 'write' }
    await hook('PreToolUse', call)
    writeFileSync(file, 'agent change\n')
    await hook('PostToolUse', call)
    await hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'weaver check objects' }, tool_use_id: 'check' })

    const root = join(top, '.git')
    const paths = [root, ...readdirSync(root, { recursive: true }).map((path) => join(root, path.toString()))]
    const modes = paths.map((path) => [path, statSync(path).mode] as const)
    const files = paths.filter((path) => statSync(path).isFile())
    const before = files.map((path) => readFileSync(path))
    if (readOnly) for (const [path, mode] of modes) chmodSync(path, mode & ~0o222)
    try {
      const result = await weaver(top, ['check', 'objects'], { under: 'claude' })
      assert.equal(result.status, 0, result.lines.join('\n'))
      assert.match(result.lines.join('\n'), /objects passed/)
      if (readOnly) {
        assert.match(result.lines.join('\n'), /Weaver state is read-only/)
        assert.deepEqual(
          files.map((path) => readFileSync(path)),
          before,
        )
        assert.equal(readdirSync(root, { recursive: true }).length, paths.length - 1)
      }
    } finally {
      if (readOnly) for (const [path, mode] of modes) chmodSync(path, mode)
    }
  })
}
