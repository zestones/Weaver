import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, test } from 'vitest'
import { CardRegistry } from '../../src/registry/card-registry.ts'
import { RegistryError } from '../../src/registry/registry-error.ts'
import { MIGRATIONS } from '../../src/registry/registry-schema.ts'
import { FLAG_BODY, findingOf, flagOf, flagRecordOf, provenanceOf, writtenOf } from '../fixtures/cards.ts'
import { registriesIn } from '../fixtures/registries.ts'

const registries = registriesIn('database')
const SOURCE = pathToFileURL(join(import.meta.dirname, '../../src/registry/card-registry.ts')).href
// A process of its own that records flags, as a hook does while a worker writes. They all start at the same moment:
// started one after the other, the first would be done before the last began.
const FLAGGER = `
import { CardRegistry } from ${JSON.stringify(SOURCE)}
const [stateDir, who, count, startAt] = process.argv.slice(1)
while (Date.now() < Number(startAt)) {}
const registry = new CardRegistry(stateDir)
const fields = { seen: 'a', expected: 'b', found: 'c', checked: 'd', did: 'left', didNote: null }
for (let index = 0; index < Number(count); index += 1) {
  const provenance = { author: who, role: 'author', session: who, subagent: null, unit: 1, requests: [], commit: null, at: new Date().toISOString() }
  registry.flag({ callId: who + '-' + index, places: [{ file: 'src/a.ts', line: index + 1 }], fields, text: who + ' ' + index, context: [], provenance })
}
registry.close()
`
const WRITERS = ['claude', 'codex', 'owner']
const FLAGS_EACH = 40

function pragma(stateDir: string, name: string): unknown {
  const db = new DatabaseSync(join(stateDir, 'registry.sqlite'))

  try {
    return db.prepare(`PRAGMA ${name}`).get()?.[name]
  } finally {
    db.close()
  }
}

afterAll(() => {
  registries.discard()
})

test('the registry creates its folder and one file in it, with a rollback journal that leaves nothing beside it', () => {
  const stateDir = join(registries.folder(), 'not', 'there', 'yet')
  const registry = new CardRegistry(stateDir)

  registry.flag(flagOf())
  registry.close()

  assert.deepEqual(readdirSync(stateDir), ['registry.sqlite'])
  assert.equal(pragma(stateDir, 'journal_mode'), 'delete')
  assert.equal(pragma(stateDir, 'user_version'), 2)
})

test('what was recorded and decided is there when the registry is opened again', () => {
  const stateDir = registries.folder()
  const first = new CardRegistry(stateDir)

  first.flag(flagOf({ callId: 'call-1' }))
  first.written(1, writtenOf())
  first.open(findingOf())
  first.tie(1, 2, 'both about the user')
  first.closeCard(2, 'wontfix', 'wanted')
  first.flag(flagOf(flagRecordOf(FLAG_BODY.replace('refresh()', 'renew()'))))
  first.merge(3, 1, 'the same thing')
  first.takeWriterTurn(process.ppid)
  first.close()

  const second = new CardRegistry(stateDir)
  const card = second.find(1)

  assert.deepEqual(
    [card?.state, card?.title, card?.record.ties, card?.record.occurrences.length],
    ['open', 'Nothing refreshes the token', [2], 1],
  )
  assert.deepEqual([second.find(2)?.record.closing?.reason, second.find(3)?.record.mergedInto], ['wanted', 1])
  assert.deepEqual(
    second.list({ states: ['raw', 'open', 'closed', 'merged'], file: 'src/auth/token.ts' }).map((found) => found.number),
    [1, 3],
  )
  assert.deepEqual(
    second.list({ label: 'type:bug' }).map((found) => found.number),
    [1],
  )
  assert.equal(second.flag(flagOf({ callId: 'call-1' })).known, true)
  assert.equal(second.open(findingOf()).number, 2)
  assert.equal(second.flag(flagOf({ provenance: provenanceOf({ session: 'session-9' }) })).card.number, 4, 'numbers go on from the last')
  assert.equal(second.takeWriterTurn(process.pid), false)
  second.close()
})

test('a registry made before cards could be written on is brought up to date when it is opened, and keeps what it held', () => {
  const stateDir = registries.folder()
  const made = new CardRegistry(stateDir)

  made.flag(flagOf())
  made.written(1, writtenOf())
  made.closeCard(1, 'wontfix', 'wanted')
  made.open(findingOf())
  made.close()

  // As the first version of the schema left it: no card has notes.
  const older = new DatabaseSync(join(stateDir, 'registry.sqlite'))

  older.exec("UPDATE cards SET record = json_remove(record, '$.notes'); PRAGMA user_version = 1")
  older.close()

  const registry = new CardRegistry(stateDir)
  const [closed, waiting] = [registry.find(1), registry.find(2)]

  assert.equal(MIGRATIONS.length, 2)
  assert.equal(pragma(stateDir, 'user_version'), 2)
  assert.deepEqual([closed?.record.notes, waiting?.record.notes], [[], []])
  assert.deepEqual(
    [closed?.standing, closed?.record.closing?.reason, closed?.title],
    ['closed (wontfix)', 'wanted', 'Nothing refreshes the token'],
  )
  assert.equal(
    registry.note(2, { provenance: provenanceOf(), conclusion: 'confirmed', text: 'Read it again.' }).card.standing,
    'open (confirmed)',
  )
  registry.close()
})

test('a database newer than the code is refused with an error that says so, and is left as it was', () => {
  const stateDir = registries.folder()
  const registry = new CardRegistry(stateDir)

  registry.flag(flagOf())
  registry.close()

  const newer = new DatabaseSync(join(stateDir, 'registry.sqlite'))

  newer.exec('PRAGMA user_version = 7; ALTER TABLE cards ADD COLUMN later TEXT')
  newer.close()

  assert.throws(
    () => new CardRegistry(stateDir),
    (error: unknown) =>
      error instanceof RegistryError &&
      error.message ===
        `${join(stateDir, 'registry.sqlite')} was written by a newer Weaver: its schema is at version 7, and this one knows up to 2. Nothing in it was changed: update Weaver to read it.`,
  )
  assert.equal(pragma(stateDir, 'user_version'), 7)

  const kept = new DatabaseSync(join(stateDir, 'registry.sqlite'))

  assert.equal(kept.prepare('SELECT COUNT(*) AS cards FROM cards').get()?.cards, 1)
  kept.close()
})

test('a state folder that cannot hold a registry is an error of the registry, whatever the cause', () => {
  const folder = registries.folder()
  const file = `${folder}-a-file`

  writeFileSync(file, 'not a folder')
  assert.throws(() => new CardRegistry(join(file, 'state')), RegistryError)

  const registry = new CardRegistry(folder)

  registry.close()
  writeFileSync(join(folder, 'registry.sqlite'), 'this is not a database, and it is long enough to be read as one'.repeat(40))
  assert.throws(() => new CardRegistry(folder), /^RegistryError: the registry at .*registry\.sqlite could not be used: /)
  assert.equal(existsSync(join(folder, 'registry.sqlite')), true)
})

test('processes that record at the same moment, on a registry none of them has created yet, lose nothing', async () => {
  const stateDir = registries.folder()
  const startAt = String(Date.now() + 500)
  const record = (who: string) =>
    promisify(execFile)(process.execPath, ['--input-type=module', '-e', FLAGGER, stateDir, who, String(FLAGS_EACH), startAt])

  await Promise.all(WRITERS.map(record))

  const registry = new CardRegistry(stateDir)
  const cards = registry.list()

  registry.close()

  assert.deepEqual(
    cards.map((card) => card.number),
    Array.from({ length: WRITERS.length * FLAGS_EACH }, (_, index) => index + 1),
  )
  assert.deepEqual(
    WRITERS.map((who) => cards.filter((card) => card.record.provenance.author === who).length),
    WRITERS.map(() => FLAGS_EACH),
  )
  assert.equal(new Set(cards.map((card) => card.record.flag?.text)).size, WRITERS.length * FLAGS_EACH)
})
