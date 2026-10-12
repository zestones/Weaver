import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import type { Repository } from '../../src/lib/git/repository.ts'
import { Journal } from '../../src/unit-of-work/journal/journal.ts'
import { declarationFiles, writeDeclaration } from '../fixtures/declaration.ts'
import { makeRepo, writeFiles } from '../fixtures/repo.ts'

const HOOK = join(import.meta.dirname, '../../src/bin/hook.ts')
const scratch = mkdtempSync(join(tmpdir(), 'weaver-warnings-'))

const DECLARATION = {
  version: 2,
  finish: { headings: ['Request', 'To validate'] },
  scope: { exclude: ['src/generated'] },
  checks: {
    syntax: {
      warn: ['node', 'tools/parse.mjs', '{files}'],
      judge: ['node', 'tools/parse.mjs', '{files}'],
      when: ['src/**/*.js'],
      rules: { S1: 'Source files parse.' },
    },
    names: {
      warn: ['node', 'tools/names.mjs', '{files}'],
      judge: ['node', 'tools/names.mjs', '{files}'],
      when: ['src/**'],
      reads: 'findings',
      rules: { N1: 'File names are lower case.', N2: { statement: 'A new folder is the owner’s to accept.', level: 'human' } },
    },
    tests: { judge: ['true'], rules: { T1: 'The tests pass.' } },
  },
}

const PARSE = `import { execFileSync } from 'node:child_process'
for (const file of process.argv.slice(2)) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' })
`
const NAMES = `const findings = process.argv.slice(2).flatMap((file) => [
  ...(file === file.toLowerCase() ? [] : [{ rule: 'N1', file, message: 'an upper-case letter in the name' }]),
  ...(file.split('/').length > 2 ? [{ rule: 'N2', file, message: 'a file in a new folder' }] : []),
])
console.log(JSON.stringify({ findings }))
`
// Prints each file of the call with what it held before and what it holds now, read from the blobs it is given.
const CHANGES = `import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const env = { ...process.env, GIT_OBJECT_DIRECTORY: process.env.WEAVER_GIT_OBJECTS, GIT_ALTERNATE_OBJECT_DIRECTORIES: join(process.cwd(), '.git/objects') }
const held = (blob) => (blob === null ? 'nothing' : execFileSync('git', ['cat-file', '-p', blob], { encoding: 'utf8', env }).trim())
for (const file of JSON.parse(readFileSync(process.env.WEAVER_CALL_DIFF, 'utf8'))) {
  console.log(file.status + ' ' + file.path + ': [' + held(file.before) + '] became [' + held(file.after) + ']')
}
process.exit(1)
`
const FINISHED = '## Request\n\nDone.\n\n## To validate\n\nNothing.\n'

interface Answer {
  readonly decision?: string
  readonly reason?: string
  readonly hookSpecificOutput?: { readonly hookEventName?: string; readonly additionalContext?: string }
}

let repo: Repository
let counter = 0
let calls = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  repo = makeRepo(join(scratch, `repo-${String(counter)}`), {
    ...declarationFiles(DECLARATION),
    'tools/parse.mjs': PARSE,
    'tools/names.mjs': NAMES,
    'tools/changes.mjs': CHANGES,
    'src/a.js': 'export const a = 1\n',
  })
})

function hook(event: string, payload: Record<string, unknown>, agent = 'claude'): Answer {
  const input = JSON.stringify({ hook_event_name: event, session_id: 'session-1', cwd: repo.top, ...payload })
  const result = spawnSync(process.execPath, [HOOK, event, `--agent=${agent}`], { input, encoding: 'utf8', cwd: repo.top })

  assert.equal(result.status, 0, result.stderr)

  return result.stdout === '' ? {} : (JSON.parse(result.stdout) as Answer)
}

// What the agent is told after a call that writes these files, as the event that ends the call says it.
function write(files: Readonly<Record<string, string>>, after = 'PostToolUse'): Answer {
  calls += 1

  const [path = '', content = ''] = Object.entries(files)[0] ?? []
  const call = { tool_name: 'Write', tool_input: { file_path: join(repo.top, path), content }, tool_use_id: `call-${String(calls)}` }

  hook('PreToolUse', call)
  writeFiles(repo.top, files)

  return hook(after, call)
}

const told = (answer: Answer): string => answer.hookSpecificOutput?.additionalContext ?? ''
// What the journal keeps of the checks that warned or could have, call after call.
const warnings = (): unknown[] =>
  new Journal(repo)
    .read()
    .flatMap((event) => (event.kind === 'warn' ? [event] : []))
    .map(({ tool, files, warned, checks }) => ({ tool, files, warned, checks: checks.map(({ id, status }) => `${id} ${status}`) }))

test('a check that warns tells the agent right after a call what it found on the files of that call, and holds nothing', () => {
  hook('UserPromptSubmit', { prompt: 'add b' })

  const answer = write({ 'src/b.js': 'export const b = ;\n' })

  assert.equal(answer.hookSpecificOutput?.hookEventName, 'PostToolUse')
  assert.match(told(answer), /^\[weaver\] `syntax` warns, right after this call\. It would hold the end of the task: fix it now\./)
  assert.match(told(answer), /SyntaxError/)
  assert.match(told(answer), /\n {2}S1: Source files parse\.$/, 'the only rule of the check is the one it warns about')
  assert.equal(answer.decision, undefined, 'the call is made: nothing is refused')

  const refused = hook('Stop', { last_assistant_message: FINISHED })

  assert.equal(refused.decision, 'block', 'the verdict is still the one of the end of the task')
  assert.match(refused.reason ?? '', /FAIL syntax/)
})

test('a warning read as findings names each place with its rule and what the rule says; what waits for the owner is not told', () => {
  hook('UserPromptSubmit', { prompt: 'add a module' })

  const answer = write({ 'src/parts/Bad.js': 'export const bad = 1\n' })

  assert.match(told(answer), /`names` warns/)
  assert.match(told(answer), /^ {2}N1 src\/parts\/Bad\.js: an upper-case letter in the name$/m)
  assert.match(told(answer), /^ {2}N1: File names are lower case\.$/m)
  assert.doesNotMatch(told(answer), /N2|new folder/)
  assert.doesNotMatch(told(answer), /`syntax`/, 'a check that finds nothing says nothing')
})

test('a call says nothing when no check that warns is about what it changed, or when they find nothing', () => {
  hook('UserPromptSubmit', { prompt: 'add files' })

  assert.deepEqual(write({ 'src/c.js': 'export const c = 3\n' }), {})
  assert.deepEqual(write({ 'docs/notes.md': 'export const b = ;\n' }), {})
  assert.deepEqual(write({ 'src/generated/Bad.js': 'export const b = ;\n' }), {}, 'a folder no check looks at')
})

test('a check that warns is given what the call changed, each file with what it held before and what it holds now', () => {
  writeDeclaration(repo.top, {
    ...DECLARATION,
    checks: { changes: { warn: ['node', 'tools/changes.mjs'], judge: ['true'], rules: { C1: 'Changes are read.' } } },
  })
  hook('UserPromptSubmit', { prompt: 'change a, add d' })

  assert.match(told(write({ 'src/a.js': 'export const a = 2\n' })), /M src\/a\.js: \[export const a = 1\] became \[export const a = 2\]/)
  assert.match(told(write({ 'src/d.js': 'export const d = 4\n' })), /A src\/d\.js: \[nothing\] became \[export const d = 4\]/)
  assert.deepEqual(
    readdirSync(join(repo.top, '.git/weaver/sessions/session-1')).filter((name) => name.startsWith('call-diff')),
    [],
    'what a call changed is told for the time of its warnings only',
  )
})

test('a warning that does not end in the time the settings give says nothing, and the call is answered', () => {
  writeDeclaration(repo.top, {
    ...DECLARATION,
    limits: { warnTimeoutSeconds: 1 },
    checks: {
      slow: { warn: ['node', '-e', 'setTimeout(() => process.exit(1), 30000)'], judge: ['true'], rules: { S1: 'It ends.' } },
    },
  })
  hook('UserPromptSubmit', { prompt: 'add e' })

  const startedAt = Date.now()

  assert.deepEqual(write({ 'src/e.js': 'export const e = 5\n' }), {})
  assert.ok(Date.now() - startedAt < 10_000, 'the call does not wait for the warning to end by itself')
  assert.deepEqual(
    warnings(),
    [{ tool: 'Write', files: 1, warned: [], checks: ['slow timeout'] }],
    'the journal keeps that it ran out of time',
  )
})

test('the journal keeps each run of a check that warns, whether it told the agent something or not', () => {
  hook('UserPromptSubmit', { prompt: 'add g, then fix it' })
  write({ 'src/g.js': 'export const g = ;\n' })
  write({ 'src/g.js': 'export const g = 7\n' })
  write({ 'notes.md': 'no check is about this file\n' })

  assert.deepEqual(warnings(), [
    { tool: 'Write', files: 1, warned: ['syntax'], checks: ['syntax fail', 'names pass'] },
    { tool: 'Write', files: 1, warned: [], checks: ['syntax pass', 'names pass'] },
  ])
})

test('a command that failed after it wrote a file is warned of what it wrote, under the event that ended it', () => {
  hook('UserPromptSubmit', { prompt: 'add f' })

  const answer = write({ 'src/f.js': 'export const f = ;\n' }, 'PostToolUseFailure')

  assert.equal(answer.hookSpecificOutput?.hookEventName, 'PostToolUseFailure')
  assert.match(told(answer), /`syntax` warns/)
})

test('Codex is warned the same way after a patch', () => {
  hook('UserPromptSubmit', { prompt: 'add g' }, 'codex')

  const patch = '*** Begin Patch\n*** Add File: src/g.js\n+export const g = ;\n*** End Patch'
  const call = { tool_name: 'apply_patch', tool_input: { command: patch }, tool_use_id: 'patch-1' }

  hook('PreToolUse', call, 'codex')
  writeFiles(repo.top, { 'src/g.js': 'export const g = ;\n' })

  const answer = hook('PostToolUse', call, 'codex')

  assert.equal(answer.hookSpecificOutput?.hookEventName, 'PostToolUse')
  assert.match(told(answer), /`syntax` warns/)
})
