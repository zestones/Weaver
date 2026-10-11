import assert from 'node:assert/strict'
import { test } from 'vitest'
import { DeclarationError } from '../../src/declaration/reading/declaration-error.ts'
import { DeclarationFile } from '../../src/declaration/reading/declaration-file.ts'

const parse = (value: unknown) => new DeclarationFile('weaver.config.json').parse(JSON.stringify(value))

function problemsOf(value: unknown): readonly string[] {
  try {
    parse(value)
  } catch (error) {
    if (error instanceof DeclarationError) return error.problems

    throw error
  }

  return []
}

const VALID = {
  version: 1,
  scope: { exclude: ['design/lab'] },
  finish: { headings: ['Request', 'To validate'], maxRounds: 2 },
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

test('a declaration is read with its defaults', () => {
  const config = parse(VALID)

  assert.deepEqual(config.exclude, ['design/lab'])
  assert.deepEqual(
    { ...config.finish },
    { headings: ['Request', 'To validate'], skill: null, maxRounds: 2, deadlineSeconds: 1200, concurrency: 3 },
  )
  assert.deepEqual(config.checks[1], {
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
    config.rules.map((rule) => `${rule.id} ${rule.level} ${rule.check ?? '-'}`),
    ['types-compile gate types', 'no-fixme gate markers', 'suppression-approved human markers', 'one-level llm -', 'names-say-what llm -'],
    'where a rule is written says who settles it',
  )
  assert.equal(config.statementOf('no-fixme'), 'No FIXME in the lines a unit adds.')
  assert.deepEqual(config.guards, [
    { id: 'installs', statement: 'Installing a dependency is the owner’s decision.', runs: ['npm install'], writes: [] },
  ])
})

test('the smallest declaration supervises a repository without checking anything', () => {
  const config = parse({ version: 1 })

  assert.deepEqual(config.checks, [])
  assert.equal(config.finish.headings, null)
})

test('a rule is its sentence, or an object when it says more; under a check it is for the agent unless it says the owner', () => {
  const rules = { plain: 'A sentence.', owner: { statement: 'For the owner.', level: 'human' } }

  assert.deepEqual(
    parse({ version: 1, checks: { c: { verify: ['true'], rules } } }).rules.map((rule) => [rule.id, rule.level, rule.statement]),
    [
      ['plain', 'gate', 'A sentence.'],
      ['owner', 'human', 'For the owner.'],
    ],
  )
  assert.deepEqual(problemsOf({ version: 1, checks: { c: { verify: ['true'], rules: { r: { statement: 'x', level: 'llm' } } } } }), [
    'checks.c.rules.r.level must be one of gate, human',
  ])
  assert.deepEqual(problemsOf({ version: 1, checks: { c: { verify: ['true'], rules: { r: 3, s: '', t: {} } } } }), [
    'checks.c.rules.r must be a text or an object',
    'checks.c.rules.s must not be empty',
    'checks.c.rules.t.statement is missing',
  ])
})

test('what ties entries together is checked: a check stands behind a rule, and a name stands for one rule', () => {
  const lint = { verify: ['true'], rules: { clean: 'x' } }

  assert.deepEqual(problemsOf({ version: 1, checks: { lint: { verify: ['true'] } } }), [
    'checks.lint stands behind no rule: give it rules, or name it as the candidates of a rule of the review',
  ])
  assert.deepEqual(problemsOf({ version: 1, checks: { c: { ...lint, after: 'd' } } }), ['checks.c.after names d, which is not a check'])
  assert.deepEqual(problemsOf({ version: 1, checks: { a: lint, b: lint }, review: { runtime: 'codex', rules: { clean: 'y' } } }), [
    'the rule clean is written twice: a name stands for one rule in the whole project',
  ])
})

test('everything wrong with the shape of the file is reported at once, in words that name the field', () => {
  assert.deepEqual(
    problemsOf({ version: 2, finish: { maxRounds: 0 }, chekcs: {}, rules: {}, guards: { '9x': {}, g: { statement: '' } } }),
    [
      'chekcs is not a known field',
      'rules is not a known field',
      'version must be 1',
      'finish.maxRounds must be at least 1',
      'guards.9x is not a valid identifier',
      'guards.9x.statement is missing',
      'guards.g.statement must not be empty',
    ],
  )
  assert.deepEqual(
    problemsOf({ version: 1, checks: { c: { verify: [], reads: 'stdout', timeoutSeconds: 1.5, after: 'd' } } }),
    ['checks.c.verify must not be empty', 'checks.c.reads must be one of exit, findings', 'checks.c.timeoutSeconds must be a whole number'],
    'the links between entries are judged once the shape is right',
  )
  assert.deepEqual(problemsOf('['), ['the file must be an object'])
  assert.deepEqual(problemsOf({}), ['version is missing'])
})

test('a file that is not JSON says so, and a file may name the schema it follows', () => {
  assert.throws(() => new DeclarationFile('weaver.config.json').parse('{'), /weaver\.config\.json is not a valid project declaration/)
  assert.deepEqual(parse({ $schema: './weaver.config.schema.json', version: 1 }).rules, [])
})

test('each level is its own kind of rule: who a failure holds, who a finding waits for, who reviews', () => {
  const [gate, , human, llm] = parse(VALID).rules

  assert.deepEqual([gate?.blocks, gate?.waitsForOwner, gate?.isReviewCriterion(['src/a.ts'])], [true, false, false])
  assert.deepEqual([human?.blocks, human?.waitsForOwner, human?.isReviewCriterion(['src/a.ts'])], [false, true, false])
  assert.deepEqual([llm?.blocks, llm?.waitsForOwner, llm?.isReviewCriterion(['src/a.ts'])], [false, false, true])
  assert.equal(llm?.isReviewCriterion(['docs/guide.md']), false, 'outside its scope')
  assert.equal(llm?.isReviewCriterion([]), false, 'nothing changed')
})

test('a project says when its work is finished: with headings, a final message that carries them all', () => {
  const { finish } = parse(VALID)

  assert.equal(finish.declaresFinished('## request\n\ndone\n\n## To Validate ##\n\nnothing\n'), true)
  assert.equal(finish.declaresFinished('## Request\n\nWhich name do you prefer?'), false)
  assert.equal(finish.declaresFinished(null), false)
  assert.equal(parse({ version: 1 }).finish.declaresFinished(null), true, 'without headings every end of turn does')
  assert.equal(parse({ version: 1, finish: { headings: ['Done'], skill: 'docs/finish.md' } }).finish.skill, 'docs/finish.md')
  assert.deepEqual(problemsOf({ version: 1, finish: { skill: 'docs/finish.md' } }), [
    'finish.skill is set without finish.headings: no final message ends a unit of work, so the skill explains nothing',
  ])
})

test('a guard holds its own sentence, and refuses something', () => {
  const guarded = parse({
    version: 1,
    guards: { config: { statement: 'Tool configuration is the owner’s.', writes: ['eslint.config.js'] } },
  })

  assert.deepEqual(guarded.guards, [
    { id: 'config', statement: 'Tool configuration is the owner’s.', writes: ['eslint.config.js'], runs: [] },
  ])
  assert.deepEqual(guarded.rules, [], 'what a guard holds is not a rule a program or a reviewer judges afterwards')
  assert.deepEqual(problemsOf({ version: 1, guards: { g: { runs: ['git commit'] } } }), ['guards.g.statement is missing'])
  assert.deepEqual(problemsOf({ version: 1, guards: { g: { statement: 'x' } } }), ['guards.g refuses nothing: it needs writes or runs'])
  assert.deepEqual(problemsOf({ version: 1, guards: { g: { statement: 'x', runs: ['claude'], rule: 'N1' } } }), [
    'guards.g.rule is not a known field',
  ])
})

const NO_SETTINGS = { model: null, effort: null, maxTurns: null, maxCostUsd: null }

test('a project says who reviews its changes, where a mistake costs the most, and whether the reviewer may experiment', () => {
  const plain = parse({ version: 1, review: { runtime: 'codex' } }).review
  const full = parse({
    version: 1,
    review: {
      runtime: 'other',
      reviewers: { claude: { model: 'opus', effort: 'max', maxCostUsd: 25 } },
      issue: ['gh', 'issue', 'create', '--title', '{title}', '--body', '{body}'],
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
      plain?.maxRounds,
    ],
    ['codex', { claude: NO_SETTINGS, codex: NO_SETTINGS }, [], null, false, 900, 1],
  )
  assert.deepEqual(
    [full.review?.runtime, full.review?.reviewers.claude, full.review?.criticalPaths, full.review?.criticalLines, full.review?.experiments],
    ['other', { ...NO_SETTINGS, model: 'opus', effort: 'max', maxCostUsd: 25 }, ['src/auth/**'], 200, true],
  )
  assert.deepEqual(full.skills, ['docs/review.md'], 'the skill of the reviewer is guarded as the others are')
  assert.deepEqual([full.review?.issue?.[0], plain?.issue, plain?.waitSeconds], ['gh', null, 1500])
  assert.equal(parse({ version: 1 }).review, null)
  assert.match(problemsOf({ version: 1, review: { runtime: 'gemini' } }).join(' '), /review\.runtime/)
})

test('a rule of the review may name the check that lists its places, and may ask for the experiment behind each finding', () => {
  const comments = { verify: ['node', 'tools/new-comments.mjs'], reads: 'findings' }
  const review = (rules: unknown) => ({ runtime: 'codex', rules })
  const listed = parse({
    version: 1,
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
  assert.deepEqual(problemsOf({ version: 1, review: review({ r: { statement: 'x', candidates: 'nowhere' } }) }), [
    'review.rules.r.candidates names nowhere, which is not a check',
  ])
  assert.deepEqual(
    problemsOf({ version: 1, checks: { c: { verify: ['true'] } }, review: review({ r: { statement: 'x', candidates: 'c' } }) }),
    ['review.rules.r.candidates names c, which reads exit: a check that lists places for the reviewer reads findings'],
  )
  assert.deepEqual(problemsOf({ version: 1, checks: { c: { verify: ['true'], rules: { r: { statement: 'x', evidence: true } } } } }), [
    'checks.c.rules.r.evidence is not a known field',
  ])
})

test('a check may carry the command that repairs before it judges', () => {
  const [check] = parse({
    version: 1,
    checks: {
      format: {
        fix: ['npx', 'prettier', '--write', '{files}'],
        verify: ['npx', 'prettier', '--check', '{files}'],
        rules: { formatted: 'Prettier decides formatting.' },
      },
    },
  }).checks

  assert.deepEqual(check?.fix, ['npx', 'prettier', '--write', '{files}'])
  assert.deepEqual(problemsOf({ version: 1, checks: { c: { verify: ['true'], fix: [] } } }), ['checks.c.fix must not be empty'])
})
