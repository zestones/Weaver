import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { AddedField } from '../../src/declaration/migrating/operations/added-field.ts'
import { RenamedField } from '../../src/declaration/migrating/operations/renamed-field.ts'
import { DeclarationMigrations } from '../../src/declaration/migrating/running/declaration-migrations.ts'
import { DeclarationError } from '../../src/declaration/reading/declaration-error.ts'
import { DeclarationFolder } from '../../src/declaration/reading/declaration-folder.ts'
import { DeclarationParts, type PartTexts } from '../../src/declaration/reading/declaration-parts.ts'
import { writeFiles } from '../fixtures/repo.ts'

const SOURCE = join(import.meta.dirname, '../../src/declaration')
const scratch = mkdtempSync(join(tmpdir(), 'weaver-migrations-'))

// A project as version 1 of the format wrote it: a check repairs with `fix` and judges with `verify`, and the settings
// give no time to warnings, which did not exist.
const FIRST: PartTexts = {
  settings: JSON.stringify({
    $schema: '/somewhere/settings.schema.json',
    version: 1,
    finish: { skill: '.weaver/skills/wv-finish.md' },
    checks: { maxRefusals: 5, totalTimeoutSeconds: 600, parallel: 2 },
  }),
  checks: JSON.stringify({
    format: {
      fix: ['npx', 'prettier', '--write', '{files}'],
      verify: ['npx', 'prettier', '--check', '{files}'],
      cwd: '.',
      reads: 'exit',
      timeoutSeconds: 120,
      rules: { formatted: 'Prettier decides formatting.' },
    },
    types: { verify: ['npx', 'tsc', '--noEmit'], cwd: '.', reads: 'exit', timeoutSeconds: 600, rules: { typed: 'The code compiles.' } },
  }),
  guards: JSON.stringify({ history: { statement: 'The owner commits.', runs: ['git commit'] } }),
}

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

// What reading a project says of its files, as its owner is told.
function problemsOf(texts: PartTexts, name: string): readonly string[] {
  const top = join(scratch, name)

  writeFiles(
    top,
    Object.fromEntries(Object.entries(texts).map(([part, text]) => [`.weaver/${DeclarationParts.FILES[part as keyof PartTexts]}`, text])),
  )

  try {
    DeclarationFolder.in(top).load()

    return []
  } catch (error) {
    if (error instanceof DeclarationError) return error.problems

    throw error
  }
}

test('files of an earlier format are brought to the one this Weaver reads, one migration after the other, each saying what it changed', () => {
  const migrations = new DeclarationMigrations(FIRST)
  const { texts, applied } = migrations.run()

  assert.equal(migrations.written, 1)
  assert.equal(migrations.isBehind, true)
  assert.deepEqual(
    migrations.pending().map((migration) => migration.label),
    ['0002-check-commands'],
  )
  assert.deepEqual(applied, [
    {
      label: '0002-check-commands',
      summary: 'The commands of a check are named for what they do, and a check may warn right after a call.',
      changes: [
        'project/checks.json: `fix` is now `repair`, in 1 place(s)',
        'project/checks.json: `verify` is now `judge`, in 2 place(s)',
        'settings.json: checks.warnTimeoutSeconds added, at 30: the seconds the checks that warn are given after one call',
      ],
    },
  ])
  assert.deepEqual(Object.keys(texts).sort(), ['checks', 'settings'], 'a file no migration changed is not rewritten')
  assert.deepEqual(JSON.parse(texts.settings ?? ''), {
    $schema: '/somewhere/settings.schema.json',
    version: DeclarationMigrations.LATEST,
    finish: { skill: '.weaver/skills/wv-finish.md' },
    checks: { maxRefusals: 5, totalTimeoutSeconds: 600, parallel: 2, warnTimeoutSeconds: 30 },
  })
  assert.match(texts.checks ?? '', /^\{\n {2}"format": \{\n {4}"repair": \[/, 'the files are written as an editor shows them')

  const declaration = new DeclarationParts('.weaver', { ...FIRST, ...texts }).declaration()

  assert.deepEqual(declaration.checks[0]?.repair, ['npx', 'prettier', '--write', '{files}'])
  assert.deepEqual(declaration.checks[1]?.judge, ['npx', 'tsc', '--noEmit'])
  assert.equal(declaration.checkLimits.maxRefusals, 5, 'what the owner had set is kept')
})

test('files in the format this Weaver reads lack no migration, and are left as they are', () => {
  const migrations = new DeclarationMigrations({ ...FIRST, ...new DeclarationMigrations(FIRST).run().texts })

  assert.equal(migrations.isBehind, false)
  assert.deepEqual(migrations.pending(), [])
  assert.deepEqual(migrations.run(), { texts: {}, applied: [] })
})

test('a project in another format is not read: its owner is told which, and that weaver update settles it', () => {
  const ahead = { settings: JSON.stringify({ version: DeclarationMigrations.LATEST + 1, checks: {} }) }

  assert.deepEqual(problemsOf(FIRST, 'behind'), [
    'settings.json: these files are in the format of version 1, and this Weaver reads version 2: run weaver update, which brings them to it',
  ])
  assert.deepEqual(problemsOf(ahead, 'ahead'), [
    'settings.json: these files are in the format of version 3, and this Weaver reads version 2: run weaver update, which installs the release that reads them',
  ])
  assert.equal(new DeclarationMigrations(ahead).isAhead, true)
  assert.deepEqual(new DeclarationMigrations(ahead).run(), { texts: {}, applied: [] }, 'a format it does not know is not touched')
})

test('a file that is not JSON is left to the reading of the declaration, which says what is wrong with it', () => {
  const { texts, applied } = new DeclarationMigrations({ ...FIRST, checks: '{ "format": ' }).run()

  assert.deepEqual(Object.keys(texts), ['settings'])
  assert.deepEqual(
    applied.map((migration) => migration.label),
    ['0002-check-commands'],
  )
  assert.equal(new DeclarationMigrations({ settings: 'not json' }).written, null)
})

test('the migrations are one per version, in order, each in a file of its name, up to the version the settings schema asks for', () => {
  const versions = DeclarationMigrations.ALL.map((migration) => migration.version)
  const schema = JSON.parse(readFileSync(join(SOURCE, 'schema/settings.schema.json'), 'utf8')) as {
    properties: { version: { const: number } }
  }

  assert.deepEqual(
    versions,
    versions.map((_, index) => index + 2),
    'version 1 is the format before any migration',
  )
  assert.equal(schema.properties.version.const, DeclarationMigrations.LATEST)
  assert.deepEqual(
    readdirSync(join(SOURCE, 'migrations')).sort(),
    DeclarationMigrations.ALL.map((migration) => `${migration.label}.ts`),
  )
})

test('a renamed field keeps its place in each entry that carries it, and an added field never replaces what the owner wrote', () => {
  const documents = {
    checks: { lint: { fix: ['a'], cwd: '.' }, types: { cwd: '.' }, $schema: 'x' as unknown as Record<string, unknown> },
    settings: { checks: { parallel: 3 } as Record<string, unknown> },
  }

  assert.deepEqual(new RenamedField('checks', 'fix', 'repair').apply(documents), {
    part: 'checks',
    text: '`fix` is now `repair`, in 1 place(s)',
  })
  assert.deepEqual(Object.keys(documents.checks.lint), ['repair', 'cwd'])
  assert.equal(new RenamedField('checks', 'fix', 'repair').apply(documents), null, 'nothing is left to rename')
  assert.equal(new RenamedField('guards', 'a', 'b').apply(documents), null, 'a file that is not there')

  const added = new AddedField('settings', ['checks', 'warnTimeoutSeconds'], 30, 'a time')

  assert.deepEqual(added.apply(documents), { part: 'settings', text: 'checks.warnTimeoutSeconds added, at 30: a time' })
  documents.settings.checks.warnTimeoutSeconds = 5
  assert.equal(added.apply(documents), null)
  assert.equal(documents.settings.checks.warnTimeoutSeconds, 5)
  assert.equal(new AddedField('settings', ['finish', 'skill'], 'x', 'a skill').apply(documents), null, 'a holder that is not there')
})
