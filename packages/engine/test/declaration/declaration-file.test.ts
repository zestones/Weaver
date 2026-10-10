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
  commands: { generators: ['npm run api:types'], readers: ['make verify'] },
  checks: {
    types: { run: ['npx', 'tsc', '--noEmit'], when: ['src/**/*.ts'], cwd: 'client', timeoutSeconds: 120 },
    markers: { run: ['node', 'tools/markers.mjs'], reads: 'findings', after: 'types' },
  },
  rules: {
    T1: { level: 'gate', statement: 'The code type-checks.', check: 'types' },
    M2: { level: 'human', statement: 'A lint suppression needs approval.', check: 'markers' },
    N1: { level: 'llm', statement: 'One level of abstraction per function.', source: 'docs/conventions.md', scope: ['src/**'] },
    A8: { level: 'human', statement: 'Installing a dependency is the owner’s decision.' },
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
    run: ['node', 'tools/markers.mjs'],
    cwd: '.',
    when: null,
    reads: 'findings',
    timeoutSeconds: 600,
    after: 'types',
  })
  assert.deepEqual(
    config.rules.map((rule) => `${rule.id} ${rule.level} ${rule.check ?? '-'}`),
    ['T1 gate types', 'M2 human markers', 'N1 llm -', 'A8 human -'],
  )
})

test('the smallest declaration supervises a repository without checking anything', () => {
  const config = parse({ version: 1 })

  assert.deepEqual(config.checks, [])
  assert.equal(config.finish.headings, null)
})

test('a level says who settles a rule, so it says whether a program may stand behind it', () => {
  assert.deepEqual(problemsOf({ version: 1, rules: { T1: { level: 'gate', statement: 'x' } } }), [
    'rules.T1 is a gate rule and nothing enforces it: it needs a check or a guard',
  ])
  assert.deepEqual(
    problemsOf({ version: 1, checks: { c: { run: ['true'] } }, rules: { N1: { level: 'llm', statement: 'x', check: 'c' } } }),
    ['rules.N1 is an llm rule and c enforces it: a reviewer settles it'],
  )
  assert.deepEqual(problemsOf({ version: 1, rules: { T1: { level: 'machine', statement: 'x' } } }), [
    'rules.T1.level must be one of gate, llm, human',
  ])
})

test('what ties entries together is checked: a check enforces a rule, and a name used for a check is one', () => {
  const gate = { level: 'gate', statement: 'x', check: 'c' }

  assert.deepEqual(problemsOf({ version: 1, checks: { lint: { run: ['true'] } } }), ['checks.lint enforces no rule'])
  assert.deepEqual(problemsOf({ version: 1, rules: { T1: { level: 'gate', statement: 'x', check: 'types' } } }), [
    'rules.T1.check names types, which is not a check',
  ])
  assert.deepEqual(problemsOf({ version: 1, checks: { c: { run: ['true'], after: 'd' } }, rules: { T1: gate } }), [
    'checks.c.after names d, which is not a check',
  ])
})

test('everything wrong with the shape of the file is reported at once, in words that name the field', () => {
  assert.deepEqual(problemsOf({ version: 2, finish: { maxRounds: 0 }, chekcs: {}, rules: { '9x': {}, T1: { level: 'machine' } } }), [
    'chekcs is not a known field',
    'version must be 1',
    'finish.maxRounds must be at least 1',
    'rules.9x is not a valid identifier',
    'rules.9x.level is missing',
    'rules.9x.statement is missing',
    'rules.T1.statement is missing',
    'rules.T1.level must be one of gate, llm, human',
  ])
  assert.deepEqual(
    problemsOf({
      version: 1,
      checks: { c: { run: [], reads: 'stdout', timeoutSeconds: 1.5, after: 'd' } },
      rules: { T1: { level: 'gate', statement: '' } },
    }),
    [
      'checks.c.run must not be empty',
      'checks.c.reads must be one of exit, findings',
      'checks.c.timeoutSeconds must be a whole number',
      'rules.T1.statement must not be empty',
    ],
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
  const [gate, human, llm] = parse(VALID).rules

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

test('a guard enforces a rule that exists and that a program may enforce, and refuses something', () => {
  const rules = { H5: { level: 'gate', statement: 'Tool configuration is the owner’s.' }, N1: { level: 'llm', statement: 'x' } }
  const guarded = parse({ version: 1, guards: { config: { writes: ['eslint.config.js'], rule: 'H5' } }, rules: { H5: rules.H5 } })

  assert.deepEqual(
    guarded.guards,
    [{ id: 'config', rule: 'H5', writes: ['eslint.config.js'], runs: [] }],
    'a guard is enough for a gate rule',
  )
  assert.deepEqual(problemsOf({ version: 1, guards: { g: { runs: ['git commit'], rule: 'H7' } } }), [
    'guards.g.rule names H7, which is not a rule',
  ])
  assert.deepEqual(problemsOf({ version: 1, guards: { g: { rule: 'H5' } }, rules: { H5: rules.H5 } }), [
    'guards.g refuses nothing: it needs writes or runs',
  ])
  assert.deepEqual(problemsOf({ version: 1, guards: { g: { runs: ['claude'], rule: 'N1' } }, rules: { N1: rules.N1 } }), [
    'rules.N1 is an llm rule and g enforces it: a reviewer settles it',
  ])
})
