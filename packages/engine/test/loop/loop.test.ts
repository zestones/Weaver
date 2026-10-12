import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterAll, beforeEach, test } from 'vitest'
import type { Repository } from '../../src/lib/git/repository.ts'
import { Journal } from '../../src/unit-of-work/journal/journal.ts'
import { cardsOf } from '../fixtures/cards.ts'
import { declarationFiles, writeDeclaration } from '../fixtures/declaration.ts'
import { git, locate, makeRepo, writeFiles } from '../fixtures/repo.ts'

const HOOK = join(import.meta.dirname, '../../src/bin/hook.ts')
const scratch = mkdtempSync(join(tmpdir(), 'weaver-loop-'))

const DECLARATION = {
  version: 2,
  finish: { headings: ['Request', 'To validate'] },
  limits: { maxRefusals: 2 },
  checks: {
    syntax: { judge: ['node', 'tools/parse.mjs', '{files}'], when: ['src/**/*.js'], rules: { S1: 'Source files parse.' } },
    markers: {
      judge: ['node', 'tools/markers.mjs'],
      when: ['src/**'],
      reads: 'findings',
      rules: {
        M1: 'No FIXME in the lines a unit adds.',
        M2: { statement: 'A lint suppression needs the owner’s approval.', level: 'human' },
      },
    },
  },
  guards: { tools: { statement: 'The checks and the history are the owner’s.', writes: ['tools/**'], runs: ['git commit'] } },
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
  readonly hookSpecificOutput?: {
    readonly hookEventName?: string
    readonly permissionDecision?: string
    readonly permissionDecisionReason?: string
    readonly additionalContext?: string
  }
}

let repo: Repository
let counter = 0
let calls = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  environment = process.env
  repo = makeRepo(join(scratch, `repo-${String(counter)}`), {
    ...declarationFiles(DECLARATION),
    'tools/parse.mjs': PARSE,
    'tools/markers.mjs': MARKERS,
    'src/a.js': 'export const a = 1\n// FIXME an old one, not this unit’s\n',
  })
})

let environment: NodeJS.ProcessEnv = process.env

function hook(event: string, payload: Record<string, unknown>, session = 'session-1', agent = 'claude'): Answer {
  const input = JSON.stringify({ hook_event_name: event, session_id: session, cwd: repo.top, ...payload })
  const result = spawnSync(process.execPath, [HOOK, event, `--agent=${agent}`], {
    input,
    encoding: 'utf8',
    cwd: repo.top,
    env: environment,
  })

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
// What happened to the work. How the hook itself ran, what was asked and how each turn ended are kept too, and told apart.
const ABOUT_THE_RUN = new Set(['hook', 'request', 'turn'])
const kinds = (repository: Repository = repo): string[] =>
  new Journal(repository)
    .read()
    .map((event) => event.kind)
    .filter((kind) => !ABOUT_THE_RUN.has(kind))

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
    /FAIL markers \(M1: No FIXME in the lines a unit adds\.\)\n {2}M1 src\/b\.js:1: FIXME left in/,
    'only the rule its finding names is quoted',
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
})

test('what the owner saves while the agent runs its tests is never charged to the agent', () => {
  hook('UserPromptSubmit', { prompt: 'run the tests' })
  tool('Bash', { command: 'npm test' }, () => writeFiles(repo.top, { 'src/owner.js': 'export const mine = ;\n' }))

  assert.deepEqual(stop(), {})
  assert.deepEqual(kinds(), ['settle'])
})

test('a call a guard refuses does not judge: the runtime is told to deny it, with the rule, and the journal keeps the attempt', () => {
  hook('UserPromptSubmit', { prompt: 'loosen the check and commit' })

  const edit = hook('PreToolUse', { tool_name: 'Write', tool_input: { file_path: join(repo.top, 'tools/markers.mjs') }, tool_use_id: 'e' })
  const commit = hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'git commit -am done' }, tool_use_id: 'c' })
  const own = hook('PreToolUse', {
    tool_name: 'Edit',
    tool_input: { file_path: join(repo.top, '.weaver/settings.json') },
    tool_use_id: 'o',
  })

  assert.equal(edit.hookSpecificOutput?.permissionDecision, 'deny')
  assert.equal(
    edit.hookSpecificOutput?.permissionDecisionReason,
    '[weaver tools] Writing tools/markers.mjs is refused. The checks and the history are the owner’s. Only the owner lifts the guards, for this session: `weaver maintenance on session-`.',
  )
  assert.match(commit.hookSpecificOutput?.permissionDecisionReason ?? '', /^\[weaver tools\] Running `git commit` is refused\./)
  assert.match(own.hookSpecificOutput?.permissionDecisionReason ?? '', /weaver:declaration/)
  assert.deepEqual(kinds(), ['refuse', 'refuse', 'refuse'])
  assert.deepEqual(stop(), {}, 'nothing was written, so nothing is left to check')
})

test('a command that exits with an error is still charged with what it wrote before', () => {
  const call = { tool_name: 'Bash', tool_input: { command: 'sed -i s/1/2/ src/a.js && node --test' }, tool_use_id: 'failing' }

  hook('UserPromptSubmit', { prompt: 'fix and test it' })
  hook('PreToolUse', call)
  writeFiles(repo.top, { 'src/a.js': 'export const a = 2\n// FIXME an old one, not this unit’s\n', 'notes.md': 'the owner’s\n' })
  hook('PostToolUseFailure', call)

  assert.match(stop().systemMessage ?? '', /passed on 1 changed file\(s\)\. Changed during its commands, not charged: notes\.md\./)
})

test('a check may repair before it judges: what it rewrites stays the unit’s work, and the agent is told to read it again', () => {
  const tidy = `import { readFileSync, writeFileSync } from 'node:fs'
const [mode, ...rest] = process.argv.slice(2)
const judging = mode === '--check'
let untidy = false
for (const file of judging ? rest : [mode, ...rest]) {
  const text = readFileSync(file, 'utf8')
  const tidied = text.replace(/[ \\t]+$/gm, '')
  untidy ||= tidied !== text
  if (!judging) writeFileSync(file, tidied)
}
process.exitCode = judging && untidy ? 1 : 0
`
  const declared = {
    version: 2,
    checks: {
      tidy: {
        repair: ['node', 'tools/tidy.mjs', '{files}'],
        judge: ['node', 'tools/tidy.mjs', '--check', '{files}'],
        when: ['src/**/*.js'],
        rules: { F1: 'No space at the end of a line.' },
      },
      syntax: { judge: ['node', 'tools/parse.mjs', '{files}'], when: ['src/**/*.js'], rules: { S1: 'Source files parse.' } },
    },
  }

  writeDeclaration(repo.top, declared)
  writeFiles(repo.top, { 'tools/tidy.mjs': tidy })
  hook('UserPromptSubmit', { prompt: 'add t' })
  write('src/t.js', 'export const t = 1   \nexport const u = ;  \n')

  const refused = stop()

  assert.equal(readFileSync(join(repo.top, 'src/t.js'), 'utf8'), 'export const t = 1\nexport const u = ;\n', 'repaired')
  assert.match(refused.reason ?? '', /FAIL syntax/, 'a repair hides nothing: the other checks judge what it left')
  assert.doesNotMatch(refused.reason ?? '', /FAIL tidy/)
  assert.match(refused.reason ?? '', /Rewritten by a repair before the checks, read them again before you edit them: src\/t\.js\./)

  write('src/t.js', 'export const t = 1\nexport const u = 2\n')

  assert.match(stop().systemMessage ?? '', /2 check\(s\) passed on 1 changed file\(s\)\. Report/)
  assert.deepEqual(kinds(), ['touch', 'touch', 'check', 'touch', 'check', 'settle'])
  assert.deepEqual(stop(), {}, 'what the repair rewrote settled with the unit')
})

test('a declared reviewer is a real agent runtime, started once the checks pass; its findings send the agent back', () => {
  const bin = join(scratch, `bin-${String(counter)}`)
  const codex = `#!/usr/bin/env node
let asked = ''
process.stdin.on('data', (chunk) => { asked += chunk })
process.stdin.on('end', () => {
  const finding = { rule: 'N1', file: 'src/r.js', line: 1, quote: 'export const r = input', problem: 'name what the input is', suggestion: null, evidence: null }
  const answer = { summary: 'Read src/r.js.', findings: asked.includes('+ export const r = input') ? [finding] : [], suspicions: [], experiments: [] }
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Reading src/r.js.' } }))
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(answer) } }))
})
`
  const declared = {
    version: 2,
    review: { runtime: 'codex', rules: { N1: { statement: 'A name says what it holds.', scope: ['src/**'] } } },
    checks: { syntax: { judge: ['node', 'tools/parse.mjs', '{files}'], when: ['src/**/*.js'], rules: { S1: 'Source files parse.' } } },
  }

  writeDeclaration(repo.top, declared)
  writeFiles(bin, { codex })
  chmodSync(join(bin, 'codex'), 0o755)
  environment = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` }
  hook('UserPromptSubmit', { prompt: 'add r' })
  write('src/r.js', 'export const r = input\n')

  const refused = stop()

  assert.equal(refused.decision, 'block')
  assert.match(refused.reason ?? '', /the reviewer \(codex\) found 1 point\(s\)[^]*\nF1 N1 src\/r\.js:1: name what the input is\n/)

  write('src/r.js', 'export const r = userInput\n')

  const settled = stop(`${FINISHED}\nF1 fixed: the constant now says whose input it holds\n`)

  assert.match(
    settled.systemMessage ?? '',
    /1 check\(s\) passed on 1 changed file\(s\)\. Reviewed by codex: 1 finding\(s\), 1 answered fixed\./,
  )
  assert.deepEqual(kinds(), ['touch', 'check', 'review', 'touch', 'check', 'answer', 'settle'])
})

test('a hook stopped while it waits leaves its review to the next end of turn, which does not start another', async () => {
  const bin = join(scratch, `bin-${String(counter)}`)
  const started = join(scratch, `started-${String(counter)}`)
  const codex = `#!/usr/bin/env node
let asked = ''
process.stdin.on('data', (chunk) => { asked += chunk })
process.stdin.on('end', () => {
  require('node:fs').appendFileSync(${JSON.stringify(started)}, 'review\\n')
  setTimeout(() => {
    const finding = { rule: 'N1', file: 'src/r.js', line: 1, quote: null, problem: 'name what the input is', suggestion: null, evidence: null }
    const answer = { summary: 'Read src/r.js.', findings: [finding], suspicions: [], experiments: [] }
    console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(answer) } }))
  }, 1500)
})
`
  const declared = {
    version: 2,
    review: { runtime: 'codex', rules: { N1: { statement: 'A name says what it holds.', scope: ['src/**'] } } },
    checks: { syntax: { judge: ['node', 'tools/parse.mjs', '{files}'], when: ['src/**/*.js'], rules: { S1: 'Source files parse.' } } },
  }

  writeDeclaration(repo.top, declared)
  writeFiles(bin, { codex })
  chmodSync(join(bin, 'codex'), 0o755)
  environment = { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` }
  hook('UserPromptSubmit', { prompt: 'add r' })
  write('src/r.js', 'export const r = input\n')

  const waiting = spawn(process.execPath, [HOOK, 'Stop', '--agent=claude'], {
    cwd: repo.top,
    env: environment,
    stdio: ['pipe', 'ignore', 'ignore'],
  })

  waiting.stdin.end(JSON.stringify({ hook_event_name: 'Stop', session_id: 'session-1', cwd: repo.top, last_assistant_message: FINISHED }))

  for (let tries = 0; tries < 200 && !existsSync(started); tries += 1) await sleep(50)

  waiting.kill('SIGKILL')

  const delivered = stop()

  assert.equal(delivered.decision, 'block')
  assert.match(delivered.reason ?? '', /\nF1 N1 src\/r\.js:1: name what the input is\n/)
  assert.equal(readFileSync(started, 'utf8'), 'review\n', 'the reviewer was started once')
})

test('a word of the owner that is almost a directive is said back at once, in a project that reviews its changes', () => {
  assert.equal(hook('UserPromptSubmit', { prompt: 'rename it #critcal' }).systemMessage, undefined, 'this project declares no review')

  writeDeclaration(repo.top, { review: { runtime: 'codex' } })

  assert.equal(
    hook('UserPromptSubmit', { prompt: 'rename it #critcal' }).systemMessage,
    '[weaver] #critcal is not a directive: did you mean #critical?',
  )
  assert.equal(hook('UserPromptSubmit', { prompt: 'rename it #critical' }).systemMessage, undefined)
})

test('an agent is told of the flag command with its request, flags through a call that never runs, and the owner reads of it', () => {
  const flag = JSON.parse(readFileSync(join(import.meta.dirname, '../payloads/claude-flag-chained.json'), 'utf8')) as Record<
    string,
    unknown
  >
  const told = hook('UserPromptSubmit', { prompt: 'read src/a.js' }).hookSpecificOutput

  assert.equal(told?.hookEventName, 'UserPromptSubmit')
  assert.match(told?.additionalContext ?? '', /flag it with the shell command below[^]*\nweaver flag <file>\[:<line>\] \.\.\. <<'EOF'\n/)

  writeFiles(repo.top, { 'src/one.js': 'export const one = 1\n' })

  const refused = hook('PreToolUse', { ...flag, cwd: repo.top, session_id: 'session-1' }).hookSpecificOutput
  const [card] = cardsOf(repo)

  assert.equal(refused?.permissionDecision, 'deny')
  assert.equal(
    refused?.permissionDecisionReason,
    '[weaver] Flag 1 recorded for the owner. This command is answered here and never runs: that is expected. Go on with your task.',
  )
  assert.deepEqual(card?.places, [
    { file: 'src/one.js', line: 1 },
    { file: 'tools/parse.mjs', line: null },
  ])
  assert.deepEqual(
    [card?.state, card?.record.provenance.session, card?.record.provenance.requests],
    ['raw', 'session-1', ['read src/a.js']],
  )
  assert.deepEqual(stop('I only read it.'), { systemMessage: '[weaver] Flagged in this turn: #1 (weaver cards).' })
  assert.deepEqual(kinds(), ['flag'])
  assert.match(
    hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'weaver close 1 fixed' }, tool_use_id: 'close' }).hookSpecificOutput
      ?.permissionDecisionReason ?? '',
    /^\[weaver weaver:owner-command\] Running `weaver close` is refused\./,
  )
})

test('a reviewer at work in a copy of the project is held there by its own hook, which keeps nothing', () => {
  const copy = join(scratch, `copy-${String(counter)}`)
  const call = (path: string) => ({ tool_name: 'Write', tool_input: { file_path: path, content: 'x' }, tool_use_id: 'c', cwd: copy })
  const asReviewer = (event: string, payload: Record<string, unknown>) =>
    JSON.parse(
      spawnSync(process.execPath, [HOOK, event, '--agent=claude', `--review-copy=${copy}`], {
        input: JSON.stringify({ session_id: 'reviewer', cwd: copy, ...payload }),
        encoding: 'utf8',
        env: { ...process.env, WEAVER_REVIEWER: '1' },
      }).stdout || '{}',
    ) as Answer

  assert.deepEqual(asReviewer('PreToolUse', call(join(copy, 'probe.test.js'))), {})
  assert.deepEqual(asReviewer('PreToolUse', call(join(tmpdir(), 'probe.txt'))), {})

  // The repositories of these tests live in the temporary folder, where a reviewer may write: the project is elsewhere.
  const project = join(homedir(), 'project')
  const refused = asReviewer('PreToolUse', call(join(project, 'src/one.js')))

  assert.equal(refused.hookSpecificOutput?.permissionDecision, 'deny')
  assert.match(refused.hookSpecificOutput?.permissionDecisionReason ?? '', /A reviewer writes only inside its copy of the project/)
  assert.equal(
    asReviewer('PreToolUse', { tool_name: 'Bash', tool_input: { command: `echo x > ${project}/src/one.js` }, tool_use_id: 'c' })
      .hookSpecificOutput?.permissionDecision,
    'deny',
  )
  assert.deepEqual(asReviewer('Stop', { last_assistant_message: 'done' }), {})
  assert.equal(existsSync(repo.stateDir), false)
})

test('a reviewer Weaver started is not supervised by Weaver: its own hooks answer nothing and keep nothing', () => {
  environment = { ...process.env, WEAVER_REVIEWER: '1' }

  const call = { tool_name: 'Write', tool_input: { file_path: join(repo.top, 'tools/markers.mjs') }, tool_use_id: 'r' }

  assert.deepEqual(hook('UserPromptSubmit', { prompt: 'review this' }, 'reviewer'), {})
  assert.deepEqual(hook('PreToolUse', call, 'reviewer'), {}, 'not even the guards: it can only read')
  assert.deepEqual(hook('Stop', { last_assistant_message: 'done' }, 'reviewer'), {})
  assert.equal(existsSync(repo.stateDir), false)
})

test('a turn that ends on a question checks nothing; a shell command is charged with the file it names', () => {
  hook('UserPromptSubmit', { prompt: 'generate d' })
  tool('Bash', { command: 'echo "export const d = 4" > src/d.js' }, () => writeFiles(repo.top, { 'src/d.js': 'export const d = 4\n' }))

  assert.match(
    stop('Should I also export it from the index?').reason ?? '',
    /end with a message that has these sections: ## Request, ## To validate\. How to write them is in \.weaver\/skills\/wv-finish\.md\. If you are waiting/,
  )
  assert.match(stop('I am waiting for your answer.').systemMessage ?? '', /Checks pending/)
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
  rmSync(join(repo.top, '.weaver'), { recursive: true })
  hook('UserPromptSubmit', { prompt: 'add h' })
  write('src/h.js', 'export const h = ;\n')

  assert.deepEqual(stop(), {})
  assert.equal(existsSync(repo.stateDir), false)

  writeDeclaration(repo.top, { checks: { lint: { judge: ['true'] } } })

  assert.match(
    stop().systemMessage ?? '',
    /Nothing is checked: \.weaver is not a valid project declaration: project\/checks\.json: lint stands behind no rule/,
  )
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
  assert.deepEqual(kinds(main), ['touch', 'check'])
})

test('the journal keeps how Weaver itself ran: what was asked, each run of the hook, each end of turn, each check', () => {
  const journal = (): ReturnType<Journal['read']> => new Journal(repo).read()

  hook('UserPromptSubmit', { prompt: 'add b #review', transcript_path: '/somewhere/session-1.jsonl' })
  hook('UserPromptSubmit', { prompt: '<task-notification>a subagent is done</task-notification>' })
  write('src/b.js', 'export const b = ;\n')
  hook('Stop', { last_assistant_message: 'Shall I go on?' })
  stop()
  write('src/b.js', 'export const b = 2\n')
  stop()

  const events = journal()
  const asked = events.filter((event) => event.kind === 'request')
  const hooks = events.filter((event) => event.kind === 'hook')
  const checks = events.filter((event) => event.kind === 'check')

  assert.deepEqual(
    asked.map(({ unit, text, directives, transcript }) => ({ unit, text, directives, transcript })),
    [{ unit: 1, text: 'add b #review', directives: ['#review'], transcript: '/somewhere/session-1.jsonl' }],
    'what a runtime injects is not a request of the owner',
  )
  assert.deepEqual(
    hooks.map(({ event, tool }) => [event, tool]),
    [
      ['UserPromptSubmit', null],
      ['UserPromptSubmit', null],
      ['PreToolUse', 'Write'],
      ['PostToolUse', 'Write'],
      ['Stop', null],
      ['Stop', null],
      ['PreToolUse', 'Write'],
      ['PostToolUse', 'Write'],
      ['Stop', null],
    ],
  )
  assert.ok(hooks.every(({ ms, subagent, session }) => ms > 0 && subagent === null && session === 'session-1'))
  assert.deepEqual(
    events.filter((event) => event.kind === 'turn').map(({ unit, finished, held }) => [unit, finished, held]),
    [
      [1, false, 'reminder'],
      [1, true, 'checks'],
      [1, true, null],
    ],
  )
  assert.deepEqual(
    checks.map(({ passed, lines, repaired, checks: runs }) => [passed, lines, repaired, runs.map(({ id, status }) => `${id} ${status}`)]),
    [
      [false, 1, 0, ['syntax fail', 'markers pass']],
      [true, 1, 0, ['syntax pass', 'markers pass']],
    ],
  )
  assert.ok(checks.every(({ checks: runs }) => runs.every(({ ms, failures }) => ms >= 0 && failures === 0)))
  assert.ok(
    events.every(({ weaver, v }) => weaver === '0.0.0-dev' && v === 2),
    'each line says which Weaver wrote it',
  )
})

test('a hook that cannot do its work is kept as an error: a configuration it cannot read, a moment that fails', () => {
  writeFiles(repo.top, { '.weaver/project/checks.json': '{ "syntax": ' })

  assert.match(hook('UserPromptSubmit', { prompt: 'add b' }).systemMessage ?? '', /^\[weaver\] Nothing is checked: /)
  assert.deepEqual(hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'x' }), {})
  assert.deepEqual(
    new Journal(repo).read().map(({ kind, session, ...event }) => [kind, session, 'event' in event ? event.event : null]),
    [
      ['error', 'session-1', 'UserPromptSubmit'],
      ['error', 'session-1', 'PreToolUse'],
    ],
    'no run of the hook is counted while nothing is checked',
  )
})
