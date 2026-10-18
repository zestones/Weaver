import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ExecutionCatalog, ScriptedExecution, type AgentExecution, type RuntimeHook } from '@weaver/agent-sdk'
import { afterAll, beforeEach, test } from 'vitest'
import { EngineLink } from '../../src/link/engine-link.ts'
import { RuntimeCatalog } from '../../src/runtimes/runtime-catalog.ts'
import { finding, flag, write } from '../fixtures/cards.ts'
import { LIMITS, makeProject, REVIEW, SETTINGS, weaver, writeConfig } from '../fixtures/project.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-doctor-'))
const link = new EngineLink()
const SKILL = '.weaver/skills/wv-finish.md'
let top: string
let counter = 0

// What the doctor found, one line each. The headings of its sections and its closing line are told apart, so that a
// test reads the findings whatever sections they fall in.
async function doctor(
  around: Parameters<typeof weaver>[2] = {},
): Promise<{ status: number; lines: string[]; sections: string[]; closing: string }> {
  const { status, lines } = await weaver(top, ['doctor'], around)

  return {
    status,
    lines: lines.filter((line) => /^ {2}[✓X-] /.test(line)),
    sections: lines.filter((line) => /^[A-Z][a-z]+$/.test(line)),
    closing: lines.at(-1) ?? '',
  }
}

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  top = makeProject(join(scratch, `project-${String(counter)}`))
})

test('a project that was never wired is told that agents work there unsupervised', async () => {
  const { status, lines } = await doctor()

  assert.equal(status, 1)
  assert.deepEqual(lines, [
    '  X No .weaver/settings.json: Weaver does nothing in this project. Run weaver install.',
    `  ✓ The hook starts: ${link.hook}`,
    '  - Claude Code: not wired',
    '  - Codex: not wired',
    '  X No agent runtime is wired: agents work here unsupervised. Run weaver install.',
  ])
  assert.deepEqual((await weaver(top, ['doctor'])).lines, [
    'Project',
    lines[0],
    '',
    'Runtimes',
    ...lines.slice(1),
    '',
    'X 2 problems to settle.',
  ])
})

test('after install everything is alive; a runtime left out is only noted', async () => {
  await weaver(top, ['install', 'claude'])

  const { status, lines, sections, closing } = await doctor()

  assert.deepEqual(sections, ['Project', 'Runtimes'], 'nothing is said of a part of Weaver the project does not use')
  assert.equal(closing, '✓ Weaver is alive in this project.')

  assert.equal(status, 0, lines.join('\n'))
  assert.deepEqual(lines, [
    '  ✓ .weaver: 0 rules, 0 checks, 0 guards',
    '  ✓ The finish skill: .weaver/skills/wv-finish.md',
    `  ✓ The hook starts: ${link.hook}`,
    '  ✓ Claude Code: wired in .claude/settings.local.json',
    '  ✓ Claude Code: the guide of Weaver in .claude/skills/weaver/SKILL.md',
    '  - Codex: not wired',
    '  - An agent started outside these runtimes is not supervised',
  ])
})

test('hooks that point to a Weaver that is no longer there are a problem, and so is a hook that does not start', async () => {
  const moved = new EngineLink(join(scratch, 'old-checkout/hook.js'), link.schemas)

  for (const runtime of new RuntimeCatalog().settings(top, moved, ['codex'])) runtime.install()

  const stale = await doctor()
  const dead = await doctor({ link: moved })

  assert.equal(stale.status, 1)
  assert.ok(stale.lines.includes('  X Codex: the hooks in .codex/hooks.json are not the ones this Weaver writes. Run weaver update.'))
  assert.equal(dead.status, 1)
  assert.ok(dead.lines.includes(`  X The hook does not start: ${moved.hook}. Build Weaver with pnpm build.`))
})

test('a finish skill that is missing, that lists no headings, or that no longer shows one it lists, is a problem', async () => {
  const header = '---\nheadings:\n  - Request\n  - To validate\n  - Found along the way\n---\n'

  await weaver(top, ['install', 'claude'])
  writeFileSync(join(top, SKILL), `${header}\n## Request\n\n## To validate\n`)

  assert.ok((await doctor()).lines.includes(`  X ${SKILL} does not show ## Found along the way, which its header lists.`))

  writeFileSync(join(top, SKILL), '## Request\n\n## To validate\n')
  assert.equal(
    (await doctor()).lines[0],
    `  X .weaver is not a valid project declaration: ${SKILL}: its header lists no \`headings\`: they are what tells Weaver that a task is finished`,
  )

  rmSync(join(top, SKILL))

  const missing = await doctor()

  assert.equal(missing.status, 1)
  assert.ok(missing.lines.includes(`  X ${SKILL} is missing, and agents are pointed to it. Run weaver install to write a template.`))
})

// Codex as the doctor finds it: what it says of the hooks of the project, each wired one in a standing.
function codexHolding(standings: readonly (RuntimeHook['standing'] | null)[], failure: string | null = null): ExecutionCatalog {
  const [runtime] = new RuntimeCatalog().settings(top, link, ['codex'])
  const wired = (runtime?.commands() ?? []).flatMap((command, index) => {
    const standing = standings[index] ?? null

    return standing === null ? [] : [{ command, standing }]
  })
  const hooks: RuntimeHook[] = [{ command: 'node the-owner-s-own-hook.js', standing: 'waits' }, ...wired]

  return new ExecutionCatalog([new ScriptedExecution('codex', [], { hooks: failure === null ? hooks : [], failure })])
}

test('Codex is asked whether it runs the hooks it was wired with: the ones of another tool do not count', async () => {
  await weaver(top, ['install'])

  const { status, lines } = await doctor({ executions: codexHolding(['runs', 'runs', 'runs', 'runs']) })

  assert.equal(status, 0, lines.join('\n'))
  assert.deepEqual(lines.slice(-6), [
    '  ✓ Claude Code: wired in .claude/settings.local.json',
    '  ✓ Claude Code: the guide of Weaver in .claude/skills/weaver/SKILL.md',
    '  ✓ Codex: wired in .codex/hooks.json',
    '  ✓ Codex: the guide of Weaver in .agents/skills/weaver/SKILL.md',
    '  ✓ Codex runs these hooks',
    '  - An agent started outside these runtimes is not supervised',
  ])
})

test('a Codex that loads none of the hooks works without Weaver, and that is a problem', async () => {
  await weaver(top, ['install', 'codex'])

  const { status, lines } = await doctor({ executions: codexHolding([]) })

  assert.equal(status, 1)
  assert.ok(
    lines.includes(
      '  X Codex does not load these hooks: it works in this project without Weaver. It loads the hooks of a project it trusts: it asks when it is first opened in the folder, and keeps the answer in its own configuration.',
    ),
    lines.join('\n'),
  )
})

test('hooks that wait for the owner’s approval, that are turned off, or that Codex does not hold, are each a problem', async () => {
  await weaver(top, ['install', 'codex'])

  const waiting = await doctor({ executions: codexHolding(['waits', 'waits', 'waits', 'waits']) })
  const mixed = await doctor({ executions: codexHolding(['runs', 'waits', 'off', null]) })
  const approve = 'until you approve them, and asks again whenever one changes: open Codex in this folder and approve them with /hooks.'

  assert.equal(waiting.status, 1)
  assert.deepEqual(waiting.lines.slice(-3, -1), [
    '  ✓ Codex: the guide of Weaver in .agents/skills/weaver/SKILL.md',
    `  X Codex does not run these hooks ${approve}`,
  ])
  assert.equal(mixed.status, 1)
  assert.deepEqual(mixed.lines.slice(-4, -1), [
    '  X Codex loads only 3 of these 4 hooks: /hooks, in Codex, shows the ones it holds.',
    `  X Codex does not run 1 of these 4 hooks ${approve}`,
    '  X Codex holds 1 of these 4 hooks turned off: turn them on there with /hooks.',
  ])
})

test('a Codex that could not say is only noted, and nothing is asked of a runtime that is absent or wired to another Weaver', async () => {
  const moved = new EngineLink(join(scratch, 'old-checkout/hook.js'), link.schemas)
  const silent = codexHolding([], 'its app server gave no answer')
  const absent: AgentExecution = {
    runtime: 'codex',
    isAvailable: () => false,
    run: () => Promise.reject(new Error('absent')),
    hooks: () => silent.find('codex')?.hooks(top) ?? Promise.resolve(null),
  }
  const said = (lines: readonly string[]): string[] => lines.filter((line) => line.includes('these hooks'))

  await weaver(top, ['install', 'claude'])
  assert.deepEqual(said((await doctor({ executions: codexHolding([]) })).lines), [])

  for (const runtime of new RuntimeCatalog().settings(top, moved, ['codex'])) runtime.install()
  assert.deepEqual(said((await doctor({ executions: codexHolding([]) })).lines), [])

  await weaver(top, ['install', 'codex'])

  const unsaid = await doctor({ executions: silent })

  assert.equal(unsaid.status, 0, unsaid.lines.join('\n'))
  assert.deepEqual(said(unsaid.lines), ['  - Codex did not say whether it runs these hooks: its app server gave no answer'])
  assert.deepEqual(said((await doctor({ executions: new ExecutionCatalog([absent]) })).lines), [])
})

test('the checks that warn right after a call are counted, and a time the end of a call cannot wait for is a problem', async () => {
  const lint = {
    warn: ['true'],
    judge: ['true'],
    cwd: '.',
    reads: 'exit',
    timeoutSeconds: 60,
    rules: { clean: 'The code passes the linter.' },
  }

  writeConfig(top, { settings: SETTINGS, checks: { lint, tests: { ...lint, warn: undefined, rules: { green: 'The tests pass.' } } } })

  assert.equal((await doctor()).lines[1], '  ✓ 1 check warns right after a call, in 30 s at most')

  writeConfig(top, { settings: { ...SETTINGS, checks: { ...LIMITS, warnTimeoutSeconds: 120 } } })

  const { status, lines } = await doctor()

  assert.equal(status, 1)
  assert.equal(
    lines[1],
    '  X The warnings after a call (120 s) may last longer than the 120 s the end of a call is given: lower checks.warnTimeoutSeconds in settings.json.',
  )
})

const RULES = { N1: 'A name says what it holds.' }

test('a reviewer that starts, with its skill and rules to judge, is alive', async () => {
  const reviewers = { ...REVIEW, runtime: 'codex', reviewers: { codex: { model: 'gpt-5.5' } }, skill: 'docs/review.md' }

  writeConfig(top, { settings: SETTINGS, reviewers, rules: RULES })
  await weaver(top, ['install', 'claude'])

  const { status, lines } = await doctor()

  assert.equal(status, 0, lines.join('\n'))
  assert.deepEqual(lines.slice(1, 5), [
    '  ✓ The review: by codex, for 1 rule',
    '  - The claude command does not start: a request marked #critical has no reviewer',
    '  ✓ The reviewer codex on gpt-5.5 starts',
    '  ✓ The review skill: docs/review.md',
  ])
})

test('a reviewer whose command does not start, whose skill is missing, or that the end of a turn cannot wait for is a problem', async () => {
  const reviewers = { ...REVIEW, runtime: 'claude', skill: 'docs/review.md', waitSeconds: 3000 }

  writeConfig(top, { settings: SETTINGS, reviewers, rules: RULES })

  const { status, lines } = await doctor()

  assert.equal(status, 1)
  assert.deepEqual(lines.slice(1, 5), [
    '  ✓ The review: by claude, for 1 rule',
    '  X claude may review here, and the claude command does not start: its reviews fail.',
    '  X docs/review.md is missing, and the reviewer is pointed to it. Run weaver install to write a template.',
    '  X The checks (1200 s) and the wait for a review (3000 s) may last longer than the 3600 s the end of a turn is given: lower checks.totalTimeoutSeconds in settings.json or waitSeconds in llm/reviewers.json.',
  ])
})

test('when either runtime may be the one that reviews, both must start', async () => {
  writeConfig(top, { settings: SETTINGS, reviewers: { ...REVIEW, runtime: 'other', experiments: true }, rules: RULES })

  assert.deepEqual((await doctor()).lines.slice(1, 4), [
    '  ✓ The review: by the runtime that did not write the change, for 1 rule, in a copy of the project where the reviewer may experiment',
    '  X claude may review here, and the claude command does not start: its reviews fail.',
    '  ✓ The reviewer codex starts',
  ])

  writeConfig(top, { settings: SETTINGS, reviewers: { ...REVIEW, runtime: 'codex', critical: { paths: ['src/auth/**'] } }, rules: RULES })
  assert.ok((await doctor()).lines.includes('  X claude may review here, and the claude command does not start: its reviews fail.'))
})

test('a review that has no rule to judge is noted', async () => {
  writeConfig(top, { settings: SETTINGS, reviewers: { ...REVIEW, runtime: 'codex' } })
  assert.ok((await doctor()).lines.includes('  - The review is by codex, and it has no rule: it has nothing to judge'))
})

test('a configuration that cannot be read is a problem, with what is wrong in it', async () => {
  await weaver(top, ['install'])
  writeFileSync(join(top, '.weaver/settings.json'), JSON.stringify({ ...SETTINGS, chekcs: {} }))

  const { status, lines } = await doctor()

  assert.equal(status, 1)
  assert.match(lines[0] ?? '', /^ {2}X \.weaver is not a valid project declaration: settings\.json: chekcs is not a known field$/)
})

const WRITER = { runtime: 'codex', model: 'gpt-5.5', timeoutSeconds: 600, skill: '.weaver/skills/wv-card.md' }

test('a writer that starts, with its skill, is alive, and the cards that wait are counted', async () => {
  writeConfig(top, { settings: SETTINGS, writer: WRITER })
  await weaver(top, ['install', 'claude'])
  flag(top)
  finding(top)

  const { status, lines } = await doctor()

  assert.equal(status, 0, lines.join('\n'))
  assert.deepEqual(lines, [
    '  ✓ .weaver: 0 rules, 0 checks, 0 guards',
    '  ✓ The writer codex on gpt-5.5 starts',
    '  ✓ The card skill: .weaver/skills/wv-card.md',
    '  ✓ The registry: 2 cards wait for you',
    `  ✓ The hook starts: ${link.hook}`,
    '  ✓ Claude Code: wired in .claude/settings.local.json',
    '  ✓ Claude Code: the guide of Weaver in .claude/skills/weaver/SKILL.md',
    '  - Codex: not wired',
    '  - An agent started outside these runtimes is not supervised',
  ])
})

test('a writer whose command does not start, or whose skill is missing, is a problem', async () => {
  writeConfig(top, { settings: SETTINGS, writer: { runtime: 'claude', timeoutSeconds: 600, skill: 'docs/card.md' } })

  const { status, lines } = await doctor()

  assert.equal(status, 1)
  assert.deepEqual(lines.slice(1, 3), [
    '  X claude writes the cards here, and the claude command does not start: flags stay raw.',
    '  X docs/card.md is missing, and the writer is pointed to it. Run weaver install to write a template.',
  ])

  writeConfig(top, { settings: SETTINGS, writer: { runtime: 'codex', timeoutSeconds: 600 } })
  assert.deepEqual((await doctor()).lines.slice(1, 3), ['  ✓ The writer codex starts', `  ✓ The hook starts: ${link.hook}`])
})

test('without a writer, the flags that wait are noted: they stay raw until one is declared', async () => {
  const note =
    '  - 1 flag waits and no writer is declared: a flag stays raw without one. .weaver/llm/writer.json says who writes the cards.'

  await weaver(top, ['install', 'claude'])
  assert.ok(!(await doctor()).lines.some((line) => line.includes('registry')), 'nothing is said of a registry that is not there')

  flag(top)
  finding(top)

  const { status, lines } = await doctor()

  assert.equal(status, 0, lines.join('\n'))
  assert.deepEqual(lines.slice(2, 4), ['  ✓ The registry: 2 cards wait for you', note])

  write(top, 1)
  assert.ok(!(await doctor()).lines.includes(note), 'a flag closed or written up no longer waits for a writer')

  flag(top, {
    provenance: { author: 'owner', role: 'owner', session: null, subagent: null, unit: null, requests: [], commit: null, at: '' },
  })
  writeConfig(top, { settings: SETTINGS, writer: WRITER })
  assert.ok(!(await doctor()).lines.some((line) => line.includes('no writer is declared')))
})

test('a registry that cannot be read is a problem, in the words of the registry', async () => {
  mkdirSync(join(top, '.git/weaver'), { recursive: true })
  writeFileSync(join(top, '.git/weaver/registry.sqlite'), 'not a database')

  const { status, lines } = await doctor()
  const problem = lines.find((line) => line.includes('registry.sqlite')) ?? ''

  assert.equal(status, 1)
  assert.match(problem, /^ {2}X The registry at .*\/\.git\/weaver\/registry\.sqlite could not be used: /)
  assert.deepEqual(await weaver(top, ['cards']), { status: 1, lines: [problem.trim()] })
})

test('a project wired to another release is told which one, and which one this is', async () => {
  const older = `"/usr/bin/node" "/home/someone/.local/share/weaver/v0.1.0/node_modules/@weaver/engine/dist/bin/hook.js" Stop --agent=claude --weaver`

  writeConfig(top, { settings: SETTINGS })
  mkdirSync(join(top, '.claude'), { recursive: true })
  writeFileSync(
    join(top, '.claude/settings.local.json'),
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: older }] }] } }),
  )

  const { status, lines } = await doctor()

  assert.equal(status, 1)
  assert.ok(
    lines.includes(
      '  X Claude Code: the hooks in .claude/settings.local.json are those of Weaver v0.1.0, and this is v0.0.0-dev. Run weaver update.',
    ),
    lines.join('\n'),
  )
})

test('a project whose configuration lacks migrations is told which, and that nothing is checked until weaver update', async () => {
  writeConfig(top, { settings: { version: 1, checks: { maxRefusals: 3, totalTimeoutSeconds: 1200, parallel: 3 } } })

  const { status, lines } = await doctor()

  assert.equal(status, 1)
  assert.equal(
    lines[0],
    '  X .weaver/ is 1 migration behind this Weaver (0002-check-commands): nothing is checked until weaver update brings it up to date.',
  )
})

test('a guide that is missing, or that another Weaver or another configuration wrote, is a problem', async () => {
  await weaver(top, ['install', 'claude'])
  const guide = join(top, '.claude/skills/weaver/SKILL.md')

  writeFileSync(guide, readFileSync(guide, 'utf8').replace('# Working under Weaver', '# Working under an older Weaver'))

  const stale = await doctor()

  assert.equal(stale.status, 1)
  assert.ok(
    stale.lines.includes(
      '  X Claude Code: the guide in .claude/skills/weaver/SKILL.md is not the one of this Weaver and this configuration. Run weaver update.',
    ),
  )

  rmSync(join(top, '.claude/skills/weaver/SKILL.md'))

  assert.ok(
    (await doctor()).lines.includes(
      '  X Claude Code: no guide of Weaver in .claude/skills/weaver/SKILL.md, which tells its agents how to work here. Run weaver update.',
    ),
  )
})

test('a skill named weaver that Weaver did not write, or a personal one Claude Code reads in place of the guide, is a problem', async () => {
  await weaver(top, ['install', 'claude'])
  writeFileSync(join(top, '.claude/skills/weaver/SKILL.md'), '---\nname: weaver\n---\nMine.\n')

  assert.ok(
    (await doctor()).lines.includes(
      '  X Claude Code: .claude/skills/weaver/SKILL.md is a skill named weaver that Weaver did not write, so its agents get no guide. Rename that skill, then run weaver update.',
    ),
  )

  const home = join(scratch, `home-${String(Date.now())}`)
  const personal = join(home, '.claude/skills/weaver/SKILL.md')
  const before = process.env.HOME

  mkdirSync(join(home, '.claude/skills/weaver'), { recursive: true })
  writeFileSync(personal, '---\nname: weaver\n---\nMine too.\n')
  process.env.HOME = home

  try {
    assert.ok(
      (await doctor()).lines.includes(
        `  X Claude Code: the personal skill ${personal} has the name of the guide, and Claude Code reads it in its place. Rename it.`,
      ),
    )
  } finally {
    process.env.HOME = before
  }
})

test('hooks called for fewer tools than this Weaver reads are to be written again', async () => {
  await weaver(top, ['install', 'claude'])

  const settings = readFileSync(join(top, '.claude/settings.local.json'), 'utf8')

  writeFileSync(join(top, '.claude/settings.local.json'), settings.replaceAll('|NotebookEdit|Agent', '|NotebookEdit'))

  assert.ok(
    (await doctor()).lines.includes(
      '  X Claude Code: the hooks in .claude/settings.local.json are not the ones this Weaver writes. Run weaver update.',
    ),
  )
})
