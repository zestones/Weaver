import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import type { Repository } from '../../src/lib/git/repository.ts'
import { Journal } from '../../src/unit-of-work/journal/journal.ts'
import { git, locate, makeRepo, writeFiles } from '../fixtures/repo.ts'

const HOOK = join(import.meta.dirname, '../../src/bin/hook.ts')
const scratch = mkdtempSync(join(tmpdir(), 'weaver-loop-'))

const DECLARATION = {
  version: 1,
  finish: { headings: ['Request', 'To validate'], maxRounds: 2 },
  checks: {
    syntax: { run: ['node', 'tools/parse.mjs', '{files}'], when: ['src/**/*.js'] },
    markers: { run: ['node', 'tools/markers.mjs'], when: ['src/**'], reads: 'findings' },
  },
  rules: {
    S1: { level: 'gate', statement: 'Source files parse.', check: 'syntax' },
    M1: { level: 'gate', statement: 'No FIXME in the lines a unit adds.', check: 'markers' },
    M2: { level: 'human', statement: 'A lint suppression needs the owner’s approval.', check: 'markers' },
    N1: { level: 'llm', statement: 'Each function stays at one level of abstraction.', scope: ['src/**'] },
  },
}

const PARSE = `import { execFileSync } from 'node:child_process'
for (const file of process.argv.slice(2)) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' })
`
const MARKERS = `import { readFileSync } from 'node:fs'
const findings = []
for (const file of JSON.parse(readFileSync(process.env.WEAVER_UNIT_DIFF, 'utf8'))) {
  if (file.status === 'D') continue
  const lines = readFileSync(file.path, 'utf8').split('\\n')
  for (const [from, to] of file.added) {
    for (let line = from; line <= to; line += 1) {
      const text = lines[line - 1] ?? ''
      if (text.includes('FIXME')) findings.push({ rule: 'M1', file: file.path, line, message: 'FIXME left in' })
      if (text.includes('eslint-disable')) findings.push({ rule: 'M2', file: file.path, line, message: 'lint suppression added' })
    }
  }
}
console.log(JSON.stringify({ findings }))
`
const FINISHED = '## Request\n\nDone.\n\n## To validate\n\nNothing.\n'

interface Answer {
  readonly decision?: string
  readonly reason?: string
  readonly systemMessage?: string
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
    'weaver.json': JSON.stringify(DECLARATION, null, 2),
    'tools/parse.mjs': PARSE,
    'tools/markers.mjs': MARKERS,
    'src/a.js': 'export const a = 1\n// FIXME an old one, not this unit’s\n',
  })
})

function hook(event: string, payload: Record<string, unknown>, session = 'session-1', agent = 'claude'): Answer {
  const input = JSON.stringify({ hook_event_name: event, session_id: session, cwd: repo.top, ...payload })
  const result = spawnSync(process.execPath, [HOOK, event, `--agent=${agent}`], { input, encoding: 'utf8', cwd: repo.top })

  assert.equal(result.status, 0, result.stderr)

  return result.stdout === '' ? {} : (JSON.parse(result.stdout) as Answer)
}

function tool(name: string, input: Record<string, unknown>, effect: () => void, session?: string): Answer {
  calls += 1

  const call = { tool_name: name, tool_input: input, tool_use_id: `call-${String(calls)}` }

  hook('PreToolUse', call, session)
  effect()

  return hook('PostToolUse', call, session)
}

function write(path: string, content: string, session?: string): void {
  tool('Write', { file_path: join(repo.top, path), content }, () => writeFiles(repo.top, { [path]: content }), session)
}

const stop = (message = FINISHED, session?: string): Answer => hook('Stop', { last_assistant_message: message }, session)
const kinds = (): string[] => new Journal(repo).read().map((event) => event.kind)

test('a unit is refused until its own diff passes the declared gates, then settles', () => {
  hook('UserPromptSubmit', { prompt: 'add b' })
  write('src/b.js', 'export const b = ;\n')

  const refused = stop()

  assert.equal(refused.decision, 'block')
  assert.match(refused.reason ?? '', /FAIL syntax \(S1: Source files parse\.\)/)
  assert.match(refused.reason ?? '', /SyntaxError/)

  write('src/b.js', 'export const b = 2 // FIXME later\n')

  const again = stop()

  assert.equal(again.decision, 'block')
  assert.match(
    again.reason ?? '',
    /FAIL markers \(M1: No FIXME in the lines a unit adds\. \| M2: [^)]*\)\n {2}M1 src\/b\.js:1: FIXME left in/,
  )

  write('src/b.js', 'export const b = 2\n')

  const passed = stop()

  assert.equal(passed.decision, undefined)
  assert.match(passed.systemMessage ?? '', /2 check\(s\) passed on 1 changed file\(s\)\./)
  assert.deepEqual(kinds(), ['touch', 'check', 'touch', 'check', 'touch', 'check', 'settle'])
})

test('the FIXME that was there before the unit is not the unit’s: only the lines it adds are judged', () => {
  hook('UserPromptSubmit', { prompt: 'bump a' })
  tool('Edit', { file_path: join(repo.top, 'src/a.js'), old_string: 'a = 1', new_string: 'a = 2' }, () => {
    writeFiles(repo.top, { 'src/a.js': 'export const a = 2\n// FIXME an old one, not this unit’s\n' })
  })

  assert.match(stop().systemMessage ?? '', /2 check\(s\) passed/)
})

test('a finding under a human rule waits for the owner and does not hold the agent', () => {
  hook('UserPromptSubmit', { prompt: 'silence the linter' })
  write('src/c.js', '// eslint-disable-next-line no-console\nconsole.log(1)\n')

  const answer = stop()
  const report = readFileSync(/Report: (\S+)/.exec(answer.systemMessage ?? '')?.[1] ?? '', 'utf8')

  assert.equal(answer.decision, undefined)
  assert.match(answer.systemMessage ?? '', /1 item\(s\) to validate\./)
  assert.match(report, /- M2 src\/c\.js:1: lint suppression added/)
  assert.match(report, /- N1: Each function stays at one level of abstraction\./)
})

test('what the owner saves while the agent runs its tests is never charged to the agent', () => {
  hook('UserPromptSubmit', { prompt: 'run the tests' })
  tool('Bash', { command: 'npm test' }, () => writeFiles(repo.top, { 'src/owner.js': 'export const mine = ;\n' }))

  assert.deepEqual(stop(), {})
  assert.deepEqual(kinds(), ['settle'])
})

test('a command that exits with an error is still charged with what it wrote before', () => {
  const call = { tool_name: 'Bash', tool_input: { command: 'sed -i s/1/2/ src/a.js && node --test' }, tool_use_id: 'failing' }

  hook('UserPromptSubmit', { prompt: 'fix and test it' })
  hook('PreToolUse', call)
  writeFiles(repo.top, { 'src/a.js': 'export const a = 2\n// FIXME an old one, not this unit’s\n', 'notes.md': 'the owner’s\n' })
  hook('PostToolUseFailure', call)

  assert.match(stop().systemMessage ?? '', /passed on 1 changed file\(s\)\. Changed during its commands, not charged: notes\.md\./)
})

test('a turn that ends on a question checks nothing; a shell command is charged with the file it names', () => {
  hook('UserPromptSubmit', { prompt: 'generate d' })
  tool('Bash', { command: 'echo "export const d = 4" > src/d.js' }, () => writeFiles(repo.top, { 'src/d.js': 'export const d = 4\n' }))

  assert.match(stop('Should I also export it from the index?').systemMessage ?? '', /Checks pending/)
  assert.match(stop().systemMessage ?? '', /passed on 1 changed file/)
})

test('two agents in one working tree are each judged on their own files', () => {
  hook('UserPromptSubmit', { prompt: 'add e' }, 'claude-1')
  hook('UserPromptSubmit', { prompt: 'add f' }, 'codex-1', 'codex')
  write('src/e.js', 'export const e = 5\n', 'claude-1')
  write('src/f.js', 'export const f = ;\n', 'codex-1')

  assert.match(stop(FINISHED, 'claude-1').systemMessage ?? '', /passed on 1 changed file/)
  assert.match(stop(FINISHED, 'codex-1').reason ?? '', /FAIL syntax/)
})

test('the owner’s commit of the agent’s work settles it without a check', () => {
  hook('UserPromptSubmit', { prompt: 'add g' })
  write('src/g.js', 'export const g = ;\n')
  git(repo.top, ['add', '-A'])
  git(repo.top, ['commit', '-qm', 'mine now'])

  assert.deepEqual(stop(), {})
  assert.deepEqual(kinds(), ['touch', 'settle', 'settle'])
})

test('a repository that declares nothing is left alone, and a declaration that cannot be read says so to the owner', () => {
  rmSync(join(repo.top, 'weaver.json'))
  hook('UserPromptSubmit', { prompt: 'add h' })
  write('src/h.js', 'export const h = ;\n')

  assert.deepEqual(stop(), {})
  assert.equal(existsSync(repo.stateDir), false)

  writeFiles(repo.top, { 'weaver.json': '{"version":1,"checks":{"lint":{"run":["true"]}}}' })

  assert.match(stop().systemMessage ?? '', /Nothing is checked: .*checks\.lint enforces no rule/)
})

test('the user’s index and object store never see the loop', () => {
  const index = readFileSync(join(repo.gitDir, 'index'))
  const objects = git(repo.top, ['count-objects'])

  hook('UserPromptSubmit', { prompt: 'add i' })
  write('src/i.js', 'export const i = 9\n')
  stop()

  assert.ok(readFileSync(join(repo.gitDir, 'index')).equals(index))
  assert.equal(git(repo.top, ['status', '--porcelain']), '?? src/i.js')
  assert.equal(git(repo.top, ['count-objects']), objects)
})

function hookAsync(event: string, payload: Record<string, unknown>): Promise<void> {
  const input = JSON.stringify({ hook_event_name: event, session_id: 'session-1', cwd: repo.top, ...payload })

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOOK, event, '--agent=claude'], { cwd: repo.top, stdio: ['pipe', 'ignore', 'inherit'] })

    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${event} exited with ${String(code)}`))
    })
    child.stdin.end(input)
  })
}

test('twelve tool calls whose hooks run at the same time all reach the unit', async () => {
  const files = Array.from({ length: 12 }, (_, index) => `src/p${String(index)}.js`)
  const callOf = (path: string) => ({
    tool_name: 'Write',
    tool_input: { file_path: join(repo.top, path), content: 'export {}\n' },
    tool_use_id: path,
  })

  hook('UserPromptSubmit', { prompt: 'write twelve files' })
  await Promise.all(files.map((path) => hookAsync('PreToolUse', callOf(path))))
  for (const path of files) writeFiles(repo.top, { [path]: 'export {}\n' })
  await Promise.all(files.map((path) => hookAsync('PostToolUse', callOf(path))))

  assert.match(stop().systemMessage ?? '', /2 check\(s\) passed on 12 changed file\(s\)\./)
})

test('a linked worktree has its own sessions and shares the journal with its repository', () => {
  const linked = join(scratch, `linked-${String(counter)}`)

  git(repo.top, ['worktree', 'add', '-q', linked, '-b', 'side'])

  const main = repo

  repo = locate(linked)
  hook('UserPromptSubmit', { prompt: 'add w in the worktree' })
  write('src/w.js', 'export const w = ;\n')

  assert.match(stop().reason ?? '', /FAIL syntax/)
  assert.equal(existsSync(join(main.gitDir, 'weaver', 'sessions')), false, 'the session belongs to the worktree it works in')
  assert.deepEqual(
    new Journal(main).read().map((event) => event.kind),
    ['touch', 'check'],
  )
})
