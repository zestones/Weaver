import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { WriterPolicy } from '../../src/declaration/content/writer-policy.ts'
import { DeclarationError } from '../../src/declaration/reading/declaration-error.ts'
import { DeclarationFolder } from '../../src/declaration/reading/declaration-folder.ts'
import { DeclarationParts, type PartTexts } from '../../src/declaration/reading/declaration-parts.ts'
import { declarationFiles, declarationOf } from '../fixtures/declaration.ts'
import { writeFiles } from '../fixtures/repo.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-declaration-'))
const parse = declarationOf

function problemsOf(read: () => unknown): readonly string[] {
  try {
    read()
  } catch (error) {
    if (error instanceof DeclarationError) return error.problems

    throw error
  }

  return []
}

const problems = (project: Record<string, unknown>) => problemsOf(() => parse(project))
// What the files themselves say, when the fault is in how a file is written.
const problemsIn = (texts: PartTexts) => problemsOf(() => new DeclarationParts('.weaver', texts).declaration())

// The settings every project writes: its limits, with the values a new project starts with.
const SETTINGS = '{"version":1,"checks":{"maxRefusals":3,"totalTimeoutSeconds":1200,"parallel":3}}'

const VALID = {
  scope: { exclude: ['design/lab'] },
  finish: { headings: ['Request', 'To validate'] },
  limits: { maxRefusals: 2 },
  scripts: { writers: ['npm run api:types'], readers: ['make verify'] },
  checks: {
    types: {
      verify: ['npx', 'tsc', '--noEmit'],
      when: ['src/**/*.ts'],
      cwd: 'client',
      timeoutSeconds: 120,
      rules: { 'types-compile': 'The code type-checks.' },
    },
    markers: {
      verify: ['node', 'tools/markers.mjs'],
      reads: 'findings',
      after: 'types',
      rules: {
        'no-fixme': 'No FIXME in the lines a unit adds.',
        'suppression-approved': { statement: 'A lint suppression needs approval.', level: 'human' },
      },
    },
  },
  guards: { installs: { statement: 'Installing a dependency is the owner’s decision.', runs: ['npm install'] } },
  review: {
    runtime: 'codex',
    rules: {
      'one-level': { statement: 'One level of abstraction per function.', scope: ['src/**'] },
      'names-say-what': 'A name says what it holds.',
    },
  },
}

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

test('a declaration is read from the files of .weaver, each part in its own', () => {
  const top = join(scratch, 'full')

  writeFiles(top, declarationFiles(VALID))

  const config = DeclarationFolder.in(top).load()

  assert.deepEqual(Object.keys(declarationFiles(VALID)).sort(), [
    '.weaver/llm/reviewers.json',
    '.weaver/llm/rules.json',
    '.weaver/project/checks.json',
    '.weaver/project/guards.json',
    '.weaver/project/scripts.json',
    '.weaver/settings.json',
    '.weaver/skills/wv-finish.md',
  ])
  assert.deepEqual(config?.exclude, ['design/lab'])
  assert.deepEqual(config?.scripts, { writers: ['npm run api:types'], readers: ['make verify'] })
  assert.deepEqual({ ...config?.finish }, { headings: ['Request', 'To validate'], skill: '.weaver/skills/wv-finish.md' })
  assert.deepEqual({ ...config?.checkLimits }, { maxRefusals: 2, totalTimeoutSeconds: 1200, parallel: 3 })
  assert.deepEqual(config?.checks[1], {
    id: 'markers',
    verify: ['node', 'tools/markers.mjs'],
    fix: null,
    cwd: '.',
    when: null,
    reads: 'findings',
    timeoutSeconds: 600,
    after: 'types',
  })
  assert.deepEqual(
    config?.rules.map((rule) => `${rule.id} ${rule.level} ${rule.check ?? '-'}`),
    ['types-compile gate types', 'no-fixme gate markers', 'suppression-approved human markers', 'one-level llm -', 'names-say-what llm -'],
    'where a rule is written says who settles it',
  )
  assert.equal(config?.statementOf('no-fixme'), 'No FIXME in the lines a unit adds.')
  assert.deepEqual(config?.guards, [
    { id: 'installs', statement: 'Installing a dependency is the owner’s decision.', runs: ['npm install'], writes: [] },
  ])
  assert.equal(config?.review?.runtime, 'codex')
})

test('a repository is supervised as soon as its settings are there; every other file is optional, and may name its schema', () => {
  const bare = join(scratch, 'bare')
  const none = join(scratch, 'none')

  writeFiles(none, { '.weaver/project/checks.json': '{}' })
  writeFiles(bare, {
    '.weaver/settings.json': `{ "$schema": "./settings.schema.json", ${SETTINGS.slice(1)}`,
    '.weaver/project/guards.json': '{ "$schema": "./guards.schema.json" }',
  })

  const config = DeclarationFolder.in(bare).load()

  assert.equal(DeclarationFolder.in(none).load(), null, 'without settings, nothing is supervised')
  assert.deepEqual([config?.checks, config?.guards, config?.rules, config?.review, config?.finish.headings], [[], [], [], null, null])
})

test('a rule is its sentence, or an object when it says more; under a check it is for the agent unless it says the owner', () => {
  const rules = { plain: 'A sentence.', owner: { statement: 'For the owner.', level: 'human' } }

  assert.deepEqual(
    parse({ checks: { c: { verify: ['true'], rules } } }).rules.map((rule) => [rule.id, rule.level, rule.statement]),
    [
      ['plain', 'gate', 'A sentence.'],
      ['owner', 'human', 'For the owner.'],
    ],
  )
  assert.deepEqual(problems({ checks: { c: { verify: ['true'], rules: { r: { statement: 'x', level: 'llm' } } } } }), [
    'project/checks.json: c.rules.r.level must be one of gate, human',
  ])
  assert.deepEqual(problems({ checks: { c: { verify: ['true'], rules: { r: 3, s: '', t: {} } } } }), [
    'project/checks.json: c.rules.r must be a text or an object',
    'project/checks.json: c.rules.s must not be empty',
    'project/checks.json: c.rules.t.statement is missing',
    'project/checks.json: c.rules.t.level is missing',
  ])
})

test('what ties entries together is checked: a check stands behind a rule, a name stands for one rule, rules for a reviewer need one', () => {
  const lint = { verify: ['true'], rules: { clean: 'x' } }

  assert.deepEqual(problems({ checks: { lint: { verify: ['true'] } } }), [
    'project/checks.json: lint stands behind no rule: give it rules, or name it as the candidates of a rule of llm/rules.json',
  ])
  assert.deepEqual(problems({ checks: { c: { ...lint, after: 'd' } } }), ['project/checks.json: c.after names d, which is not a check'])
  assert.deepEqual(problems({ checks: { a: lint, b: lint }, review: { runtime: 'codex', rules: { clean: 'y' } } }), [
    'the rule clean is written twice: a name stands for one rule in the whole project',
  ])
  assert.deepEqual(problemsIn({ settings: SETTINGS, rules: '{"r":"x"}' }), [
    'llm/rules.json holds rules, and llm/reviewers.json is not there to say who reviews',
  ])
})

test('everything wrong with the shape of the files is reported at once, each with the file and the field', () => {
  assert.deepEqual(
    problemsIn({
      settings: JSON.stringify({ version: 2, checks: { maxRefusals: 0, totalTimeoutSeconds: 1200, parallel: 3 }, chekcs: {} }),
      guards: JSON.stringify({ '9x': {}, g: { statement: '' } }),
      checks: JSON.stringify({ c: { verify: [], cwd: '.', reads: 'stdout', timeoutSeconds: 1.5, after: 'd' } }),
      reviewers: JSON.stringify({
        runtime: 'gemini',
        experiments: false,
        timeoutSeconds: 900,
        waitSeconds: 1500,
        maxRefusals: 1,
        rules: {},
      }),
    }),
    [
      'settings.json: chekcs is not a known field',
      'settings.json: version must be 1',
      'settings.json: checks.maxRefusals must be at least 1',
      'project/guards.json: 9x is not a valid name',
      'project/guards.json: 9x.statement is missing',
      'project/guards.json: g.statement must not be empty',
      'project/checks.json: c.verify must not be empty',
      'project/checks.json: c.reads must be one of exit, findings',
      'project/checks.json: c.timeoutSeconds must be a whole number',
      'llm/reviewers.json: rules is not a known field',
      'llm/reviewers.json: runtime must be one of claude, codex, same, other',
    ],
    'the links between entries are judged once the shape is right',
  )
  assert.deepEqual(problemsIn({ settings: '[]' }), ['settings.json: the file must be an object'])
  assert.deepEqual(problemsIn({ settings: '{}' }), ['settings.json: version is missing', 'settings.json: checks is missing'])
  assert.match(problemsIn({ settings: SETTINGS, guards: '{' }).join(' '), /^project\/guards\.json: .*JSON/)
  assert.throws(
    () => new DeclarationParts('.weaver', { settings: '{' }).declaration(),
    /^DeclarationError: \.weaver is not a valid project declaration: settings\.json: /,
  )
})

test('a file writes every limit Weaver applies: one left out is a problem, never a value the file does not show', () => {
  const written = {
    settings: '{"version":1,"checks":{}}',
    checks: JSON.stringify({ c: { verify: ['true'], rules: { plain: 'x', owner: { statement: 'y' } } } }),
    reviewers: '{"runtime":"codex"}',
  }

  assert.deepEqual(problemsIn(written), [
    'settings.json: checks.maxRefusals is missing',
    'settings.json: checks.totalTimeoutSeconds is missing',
    'settings.json: checks.parallel is missing',
    'project/checks.json: c.cwd is missing',
    'project/checks.json: c.reads is missing',
    'project/checks.json: c.timeoutSeconds is missing',
    'project/checks.json: c.rules.owner.level is missing',
    'llm/reviewers.json: experiments is missing',
    'llm/reviewers.json: timeoutSeconds is missing',
    'llm/reviewers.json: waitSeconds is missing',
    'llm/reviewers.json: maxRefusals is missing',
  ])
  assert.deepEqual(
    problemsIn({ settings: SETTINGS, guards: '{"g":{"statement":"x","runs":["git commit"]}}', rules: '{}' }),
    [],
    'what may be left out is what means none when it is: a skill, a repair, a scope, a list',
  )
})

test('each level is its own kind of rule: who a failure holds, who a finding waits for, who reviews', () => {
  const [gate, , human, llm] = parse(VALID).rules

  assert.deepEqual([gate?.blocks, gate?.waitsForOwner, gate?.isReviewCriterion(['src/a.ts'])], [true, false, false])
  assert.deepEqual([human?.blocks, human?.waitsForOwner, human?.isReviewCriterion(['src/a.ts'])], [false, true, false])
  assert.deepEqual([llm?.blocks, llm?.waitsForOwner, llm?.isReviewCriterion(['src/a.ts'])], [false, false, true])
  assert.equal(llm?.isReviewCriterion(['docs/guide.md']), false, 'outside its scope')
  assert.equal(llm?.isReviewCriterion([]), false, 'nothing changed')
})

test('a project says when its work is finished in its finish skill: a final message that carries all the headings its header lists', () => {
  const { finish } = parse(VALID)
  const skilled = (skill: string) =>
    new DeclarationParts('.weaver', { settings: SETTINGS.replace('"checks"', '"finish":{"skill":"docs/finish.md"},"checks"') }, () => skill)

  assert.equal(finish.declaresFinished('## request\n\ndone\n\n## To Validate ##\n\nnothing\n'), true)
  assert.equal(finish.declaresFinished('## Request\n\nWhich name do you prefer?'), false)
  assert.equal(finish.declaresFinished(null), false)
  assert.equal(parse({}).finish.declaresFinished(null), true, 'without a finish skill every end of turn ends the task')
  assert.deepEqual(skilled('---\ndescription: How to end.\nheadings: [Done, "To check"]\n---\n\n## Done\n').declaration().finish.headings, [
    'Done',
    'To check',
  ])
  assert.deepEqual(
    [parse({ finish: { skill: 'docs/finish.md' } }).finish.skill, parse({ finish: { skill: 'docs/finish.md' } }).finish.headings],
    ['docs/finish.md', null],
    'a skill that is not written yet teaches nothing: the doctor says so',
  )
  assert.deepEqual(
    problemsOf(() => skilled('---\ndescription: How to end.\n---\n\n## Done\n').declaration()),
    ['docs/finish.md: its header lists no `headings`: they are what tells Weaver that a task is finished'],
  )
  assert.deepEqual(problemsIn({ settings: SETTINGS.replace('"checks"', '"finish":{"headings":["Done"]},"checks"') }), [
    'settings.json: finish.headings is not a known field',
  ])
})

test('a guard holds its own sentence, and refuses something', () => {
  const guarded = parse({ guards: { config: { statement: 'Tool configuration is the owner’s.', writes: ['eslint.config.js'] } } })

  assert.deepEqual(guarded.guards, [
    { id: 'config', statement: 'Tool configuration is the owner’s.', writes: ['eslint.config.js'], runs: [] },
  ])
  assert.deepEqual(guarded.rules, [], 'what a guard holds is not a rule a program or a reviewer judges afterwards')
  assert.deepEqual(problems({ guards: { g: { runs: ['git commit'] } } }), ['project/guards.json: g.statement is missing'])
  assert.deepEqual(problems({ guards: { g: { statement: 'x' } } }), ['project/guards.json: g refuses nothing: it needs writes or runs'])
})

const NO_SETTINGS = { model: null, effort: null }

test('a project says who reviews its changes, where a mistake costs the most, and whether the reviewer may experiment', () => {
  const plain = parse({ review: { runtime: 'codex' } }).review
  const full = parse({
    review: {
      runtime: 'other',
      reviewers: { claude: { model: 'opus', effort: 'max' } },
      critical: { paths: ['src/auth/**'], lines: 200 },
      experiments: true,
      skill: 'docs/review.md',
    },
  })

  assert.deepEqual(
    [
      plain?.runtime,
      plain?.reviewers,
      plain?.criticalPaths,
      plain?.criticalLines,
      plain?.experiments,
      plain?.timeoutSeconds,
      plain?.maxRefusals,
    ],
    ['codex', { claude: NO_SETTINGS, codex: NO_SETTINGS }, [], null, false, 900, 1],
  )
  assert.deepEqual(
    [full.review?.runtime, full.review?.reviewers.claude, full.review?.criticalPaths, full.review?.criticalLines, full.review?.experiments],
    ['other', { model: 'opus', effort: 'max' }, ['src/auth/**'], 200, true],
  )
  assert.deepEqual(full.skills, ['docs/review.md'], 'the skill of the reviewer is guarded as the others are')
  assert.equal(plain?.waitSeconds, 1500)
  assert.equal(parse({}).review, null)
  assert.deepEqual(
    problems({ review: { runtime: 'codex', issue: ['gh', 'issue', 'create'] } }),
    ['llm/reviewers.json: issue is not a known field'],
    'a project without a reviewer files issues too: the command has a file of its own',
  )
})

const CARD_SECTIONS = ['Observation', 'Context', 'Trace', 'Uncertainties']

test('the labels of a card, the command that files an issue and the writer are each read from their own file, which may name its schema', () => {
  const top = join(scratch, 'cards')
  const labels = { type: { bug: 'Something does not work.', 'tech-debt': 'Code to clean up.' }, area_2: { auth: 'Signing in.' } }
  const command = ['gh', 'issue', 'create', '--title', '{title}', '--body', '{body}', '--label', '{labels}']
  const writer = { runtime: 'claude', model: 'sonnet', effort: 'low', timeoutSeconds: 300, skill: '.weaver/skills/wv-card.md' }

  writeFiles(top, {
    '.weaver/settings.json': SETTINGS,
    '.weaver/project/labels.json': JSON.stringify({ $schema: './labels.schema.json', ...labels }),
    '.weaver/project/issues.json': JSON.stringify({ $schema: './issues.schema.json', command }),
    '.weaver/llm/writer.json': JSON.stringify({ $schema: './writer.schema.json', ...writer }),
    '.weaver/skills/wv-card.md': '---\ndescription: How a card is written.\nsections: [What, "Why it matters"]\n---\n\n## What\n',
  })

  const config = DeclarationFolder.in(top).load()

  assert.deepEqual(config?.labels, labels)
  assert.deepEqual(config?.issue, command)
  assert.deepEqual({ ...config?.writer }, { ...writer, sections: ['What', 'Why it matters'] })
  assert.deepEqual(config?.skills, ['.weaver/skills/wv-card.md'], 'the skill of the writer is guarded as the others are')
})

test('a project that declares none of them has no label, no writer and no command; a writer may say only who writes and for how long', () => {
  const bare = parse({})
  const plain = parse({ writer: { runtime: 'codex' } }).writer

  assert.deepEqual([bare.labels, bare.writer, bare.issue, bare.skills], [{}, null, null, []])
  assert.deepEqual({ ...plain }, { runtime: 'codex', model: null, effort: null, timeoutSeconds: 600, skill: null, sections: CARD_SECTIONS })
})

test('the sections of a card are listed in the header of the skill of the writer; the four agreed ones stand until it is written', () => {
  const card = 'docs/card.md'
  const skilled = (skill: string) =>
    new DeclarationParts(
      '.weaver',
      { settings: SETTINGS, writer: JSON.stringify({ runtime: 'codex', timeoutSeconds: 300, skill: card }) },
      () => skill,
    )
  const unwritten = parse({ writer: { runtime: 'codex', skill: card } })

  assert.deepEqual(WriterPolicy.SECTIONS, CARD_SECTIONS)
  assert.deepEqual(
    skilled('---\ndescription: How a card is written.\nsections:\n  - Facts\n  - "Open doubts"\n---\n').declaration().writer?.sections,
    ['Facts', 'Open doubts'],
  )
  assert.deepEqual(parse({ writer: { runtime: 'codex', sections: ['Facts'] } }).writer?.sections, ['Facts'])
  assert.deepEqual(
    [unwritten.writer?.skill, unwritten.writer?.sections],
    [card, CARD_SECTIONS],
    'a skill that is not written yet lists nothing',
  )
  assert.deepEqual(
    problemsOf(() => skilled('---\ndescription: How a card is written.\n---\n\n## Facts\n').declaration()),
    ['docs/card.md: its header lists no `sections`: they are what the writer writes in the body of a card'],
  )
  assert.deepEqual(
    parse({
      finish: { skill: 'docs/finish.md' },
      review: { runtime: 'codex', skill: 'docs/review.md' },
      writer: { runtime: 'codex', skill: card },
    }).skills,
    ['docs/finish.md', 'docs/review.md', card],
  )
})

test('what is wrong with the labels, the issues and the writer is reported with the file and the field', () => {
  assert.deepEqual(
    problemsIn({
      settings: SETTINGS,
      labels: JSON.stringify({ 'kind!': {}, type: { 'to do': 'x', bug: '', debt: 3 }, area: 'auth' }),
      issues: JSON.stringify({ command: ['gh', ''], labels: ['bug'] }),
      writer: JSON.stringify({ runtime: 'gemini', model: '', effort: 3, timeoutSeconds: 0, skill: '', maxCostUsd: 1 }),
    }),
    [
      'project/labels.json: kind! is not a valid name',
      'project/labels.json: type.to do is not a valid name',
      'project/labels.json: type.bug must not be empty',
      'project/labels.json: type.debt must be a text',
      'project/labels.json: area must be an object',
      'project/issues.json: labels is not a known field',
      'project/issues.json: command.1 must not be empty',
      'llm/writer.json: maxCostUsd is not a known field',
      'llm/writer.json: runtime must be one of claude, codex',
      'llm/writer.json: model must not be empty',
      'llm/writer.json: effort must be a text',
      'llm/writer.json: timeoutSeconds must be at least 1',
      'llm/writer.json: skill must not be empty',
    ],
  )
  assert.deepEqual(problemsIn({ settings: SETTINGS, issues: '{}', writer: '{}' }), [
    'project/issues.json: command is missing',
    'llm/writer.json: runtime is missing',
    'llm/writer.json: timeoutSeconds is missing',
  ])
  assert.deepEqual(
    problemsIn({ settings: SETTINGS, labels: '[]', issues: '{"command":[]}', writer: '{"runtime":"codex","timeoutSeconds":1.5}' }),
    [
      'project/labels.json: the file must be an object',
      'project/issues.json: command must not be empty',
      'llm/writer.json: timeoutSeconds must be a whole number',
    ],
  )
  assert.deepEqual(problemsIn({ settings: SETTINGS, issues: '{"command":"gh issue create"}' }), [
    'project/issues.json: command must be a list',
  ])
})

test('a rule of the review may name the check that lists its places, and may ask for the experiment behind each finding', () => {
  const comments = { verify: ['node', 'tools/new-comments.mjs'], reads: 'findings' }
  const review = (rules: unknown) => ({ runtime: 'codex', rules })
  const listed = parse({
    checks: { comments },
    review: review({
      'comments-explain': { statement: 'A comment explains a real difficulty.', candidates: 'comments' },
      'no-defect': { statement: 'The change has no defect.', evidence: true },
    }),
  })

  assert.deepEqual(
    listed.rules.map((rule) => [rule.id, rule.level, rule.check, rule.evidence]),
    [
      ['comments-explain', 'llm', 'comments', false],
      ['no-defect', 'llm', null, true],
    ],
  )
  assert.deepEqual(
    listed.rulesOf('comments').map((rule) => rule.id),
    ['comments-explain'],
  )
  assert.deepEqual(problems({ review: review({ r: { statement: 'x', candidates: 'nowhere' } }) }), [
    'llm/rules.json: r.candidates names nowhere, which is not a check',
  ])
  assert.deepEqual(problems({ checks: { c: { verify: ['true'] } }, review: review({ r: { statement: 'x', candidates: 'c' } }) }), [
    'llm/rules.json: r.candidates names c, which reads exit: a check that lists places for the reviewer reads findings',
  ])
  assert.deepEqual(problems({ checks: { c: { verify: ['true'], rules: { r: { statement: 'x', level: 'gate', evidence: true } } } } }), [
    'project/checks.json: c.rules.r.evidence is not a known field',
  ])
})

test('a check may carry the command that repairs before it judges', () => {
  const [check] = parse({
    checks: {
      format: {
        fix: ['npx', 'prettier', '--write', '{files}'],
        verify: ['npx', 'prettier', '--check', '{files}'],
        rules: { formatted: 'Prettier decides formatting.' },
      },
    },
  }).checks

  assert.deepEqual(check?.fix, ['npx', 'prettier', '--write', '{files}'])
  assert.deepEqual(problems({ checks: { c: { verify: ['true'], fix: [] } } }), ['project/checks.json: c.fix must not be empty'])
})
