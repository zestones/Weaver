import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, test } from 'vitest'
import { AgentCatalog } from '../../src/agents/runtimes/agent-catalog.ts'
import { Payload } from '../../src/agents/events/payload.ts'
import { ProjectGuards } from '../../src/guards/deciding/project-guards.ts'
import type { Repository } from '../../src/lib/git/repository.ts'
import { declarationOf } from '../fixtures/declaration.ts'
import { git, makeRepo } from '../fixtures/repo.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-guards-'))
const catalog = new AgentCatalog()
const DECLARATION = {
  version: 2,
  guards: {
    'tool-config': {
      statement: 'Tool configuration is the owner’s.',
      writes: ['client/eslint.config.js', 'client/tsconfig*.json', '.github/workflows/**'],
    },
    'git-writes': { statement: 'Commits are the owner’s.', runs: ['git commit', 'git push'] },
    installs: { statement: 'Installing a dependency is the owner’s decision.', runs: ['npm install', 'pnpm add'] },
  },
}
let repo: Repository
let guards: ProjectGuards

beforeAll(() => {
  repo = makeRepo(join(scratch, 'repo'), { 'client/eslint.config.js': 'export default []\n', 'src/a.ts': 'export const a = 1\n' })
  guards = new ProjectGuards(declarationOf(DECLARATION), repo)
})

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

function refusalOf(tool: string, input: Record<string, unknown>, agent = 'claude'): string | null {
  const event = catalog.fromArguments([`--agent=${agent}`]).read(new Payload({ cwd: repo.top, tool_name: tool, tool_input: input }))

  return event.call === null ? null : (guards.refusal(event.call)?.reason ?? null)
}

const bash = (command: string): string | null => refusalOf('Bash', { command })

test('an edit of a guarded file is refused with the rule it breaks, whichever runtime makes it', () => {
  const patch = '*** Begin Patch\n*** Update File: client/tsconfig.app.json\n@@\n-a\n+b\n*** End Patch'

  assert.equal(
    refusalOf('Edit', { file_path: join(repo.top, 'client/eslint.config.js') }),
    '[weaver tool-config] Writing client/eslint.config.js is refused. Tool configuration is the owner’s.',
  )
  assert.match(
    refusalOf('apply_patch', { command: patch }, 'codex') ?? '',
    /^\[weaver tool-config\] Writing client\/tsconfig\.app\.json is refused/,
  )
  assert.match(refusalOf('Write', { file_path: join(repo.top, '.github/workflows/ci.yml') }) ?? '', /tool-config/)
  assert.equal(refusalOf('Write', { file_path: join(repo.top, 'src/a.ts') }), null)
  assert.equal(refusalOf('Read', { file_path: join(repo.top, 'client/eslint.config.js') }), null, 'reading is never refused')
})

test('a shell command is refused for the guarded file it names, and for the guarded files under a folder it removes', () => {
  assert.match(bash('echo "export default [1]" > client/eslint.config.js') ?? '', /Writing client\/eslint\.config\.js/)
  assert.match(bash('cd client && sed -i s/a/b/ eslint.config.js') ?? '', /Writing client\/eslint\.config\.js/)
  assert.match(bash('npx prettier --write src && mv src/a.ts client/tsconfig.json') ?? '', /Writing client\/tsconfig\.json/)
  assert.match(bash('rm -rf client') ?? '', /^\[weaver tool-config\] Writing client is refused/)
  assert.equal(bash('cp src/a.ts client'), null, 'writing into a folder does not remove what it holds')
  assert.equal(bash('cat client/eslint.config.js && rm -rf src/old'), null)
})

test('a link cannot hide the guarded file a write lands on', () => {
  symlinkSync(join(repo.top, 'client'), join(repo.top, 'alias'))

  assert.match(refusalOf('Write', { file_path: join(repo.top, 'alias/eslint.config.js') }) ?? '', /Writing client\/eslint\.config\.js/)
})

test('a command is refused by the words that name it, through the wrappers that run it', () => {
  for (const command of [
    'git commit -m x',
    'git -C . commit -m x',
    'timeout 30 git commit -m x',
    'bash -c "git commit -m x"',
    'git add . && git push',
  ]) {
    assert.match(bash(command) ?? '', /^\[weaver git-writes\] .* is refused\. Commits are the owner’s\.$/, command)
  }

  assert.equal(
    bash('npm install left-pad'),
    '[weaver installs] Running `npm install` is refused. Installing a dependency is the owner’s decision.',
  )

  for (const command of ['git status', 'git log --oneline', 'git add .', 'npm test', 'echo git commit'])
    assert.equal(bash(command), null, command)
})

test('Weaver’s configuration, its state and the agent’s hook settings are guarded whatever the project declares', () => {
  const bare = new ProjectGuards(declarationOf({}), repo)
  const refusal = (tool: string, input: Record<string, unknown>): string | null => {
    const { call } = catalog.fromArguments([]).read(new Payload({ cwd: repo.top, tool_name: tool, tool_input: input }))

    return call === null ? null : (bare.refusal(call)?.reason ?? null)
  }

  for (const path of [
    '.weaver/settings.json',
    '.weaver/project/checks.json',
    '.weaver/skills/wv-finish.md',
    '.claude/settings.json',
    '.claude/settings.local.json',
    '.codex/hooks.json',
    '.git/weaver/sessions/s/state.json',
  ]) {
    assert.match(
      refusal('Write', { file_path: join(repo.top, path) }) ?? '',
      /^\[weaver weaver:protected\] Writing .* is refused\. Weaver's configuration/,
      path,
    )
  }

  assert.match(
    refusal('Edit', { file_path: join(repo.top, '.weaver/llm/rules.json') }) ?? '',
    /^\[weaver weaver:protected\] Writing \.weaver\/llm\/rules\.json is refused/,
  )
  assert.match(refusal('Bash', { command: 'rm -rf .git/weaver' }) ?? '', /weaver:protected/)
  assert.match(refusal('Bash', { command: 'rm -rf .git' }) ?? '', /weaver:protected/, 'a removed folder takes Weaver’s state with it')
  assert.match(refusal('Bash', { command: 'echo {} > .weaver/settings.json' }) ?? '', /weaver:protected/)
  assert.match(refusal('Bash', { command: 'rm -rf .weaver' }) ?? '', /weaver:protected/)
  assert.equal(refusal('Write', { file_path: join(repo.top, '.claude/notes.md') }), null)
  assert.equal(refusal('Bash', { command: 'git status' }), null)
})

test('the commands of Weaver that decide or change are the owner’s, however an agent runs them; the ones that read are let through', () => {
  const bare = new ProjectGuards(declarationOf({}), repo)
  const refusal = (command: string): string | null => {
    const { call } = catalog.fromArguments([]).read(new Payload({ cwd: repo.top, tool_name: 'Bash', tool_input: { command } }))

    return call === null ? null : (bare.refusal(call)?.reason ?? null)
  }
  const owned = [
    ['close 12 wontfix "not now"', 'close'],
    ['install', 'install'],
    ['uninstall', 'uninstall'],
    ['cards reopen 12', 'cards reopen'],
    ['cards retitle 12 "A better title"', 'cards retitle'],
    ['cards label 12 type:bug', 'cards label'],
    ['cards rewrite 12', 'cards rewrite'],
    ['cards tie 12 13', 'cards tie'],
    ['cards untie 12 13', 'cards untie'],
    ['cards separate 12', 'cards separate'],
  ] as const

  for (const [words, named] of owned) {
    for (const program of ['weaver', '/opt/weaver/bin/weaver', 'node /opt/weaver/dist/bin/weaver.js', 'cd src && timeout 30 weaver']) {
      assert.equal(
        refusal(`${program} ${words}`),
        `[weaver weaver:owner-command] Running \`weaver ${named}\` is refused. Deciding on a card and plugging Weaver in or out are the owner's, from a terminal of their own.`,
        `${program} ${words}`,
      )
    }
  }

  assert.match(refusal('weaver cards --all && weaver close 3 fixed') ?? '', /Running `weaver close`/)
  assert.match(refusal('echo fixed | weaver cards rewrite 3') ?? '', /Running `weaver cards rewrite`/)

  for (const command of [
    'weaver cards',
    'weaver cards 12',
    'weaver cards --all --file src/a.ts --label type:bug',
    'weaver doctor',
    'node /opt/weaver/dist/bin/weaver.js cards 12',
    'echo weaver close 12 fixed',
    'git close 12',
  ]) {
    assert.equal(refusal(command), null, command)
  }
})

test('the skill that says how a task ends is guarded as soon as the configuration names it', () => {
  const declared = declarationOf({ finish: { headings: ['Done'], skill: '.agents/skills/wv-finish.md' } })
  const { call } = catalog
    .fromArguments([])
    .read(new Payload({ cwd: repo.top, tool_name: 'Edit', tool_input: { file_path: join(repo.top, '.agents/skills/wv-finish.md') } }))

  assert.match(
    (call === null ? null : new ProjectGuards(declared, repo).refusal(call)?.reason) ?? '',
    /^\[weaver weaver:protected\] Writing \.agents\/skills\/wv-finish\.md is refused/,
  )
  assert.equal(call === null ? null : guards.refusal(call), null, 'not guarded when no configuration names it')
})

test('the state of a linked worktree is guarded where it lives, outside the working tree', () => {
  const linked = join(scratch, 'linked')

  git(repo.top, ['worktree', 'add', '-q', linked, '-b', 'side'])

  const bare = new ProjectGuards(declarationOf({}), repo)
  const { call } = catalog
    .fromArguments([])
    .read(new Payload({ cwd: linked, tool_name: 'Bash', tool_input: { command: `rm -rf ${join(repo.commonDir, 'weaver')}` } }))

  assert.match((call === null ? null : bare.refusal(call)?.reason) ?? '', /weaver:protected/)
})
