import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { inTransaction, migrate, openDatabase, schemaVersion } from '../../../src/lib/sqlite/database.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-memory-sqlite-'))
const FIRST = 'CREATE TABLE notes (id INTEGER PRIMARY KEY, text TEXT NOT NULL)'
const SECOND = "ALTER TABLE notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'plain'; CREATE INDEX notes_by_kind ON notes (kind)"
let files = 0
const fresh = (): string => join(scratch, `${String(++files)}.sqlite`)

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

test('migrations are applied in order, each once, and the version of the database counts them', () => {
  const path = fresh()
  const db = openDatabase(path, 1000)

  assert.equal(schemaVersion(db), 0)
  assert.equal(migrate(db, [FIRST]), true)
  assert.equal(schemaVersion(db), 1)

  db.prepare('INSERT INTO notes (text) VALUES (?)').run('kept')
  db.close()

  const later = openDatabase(path, 1000)

  assert.equal(migrate(later, [FIRST, SECOND]), true)
  assert.equal(migrate(later, [FIRST, SECOND]), true, 'a database that is up to date is left alone')
  assert.equal(schemaVersion(later), 2)
  assert.deepEqual({ ...later.prepare('SELECT text, kind FROM notes').get() }, { text: 'kept', kind: 'plain' })
  later.close()
})

test('a database past the last migration is refused, and nothing in it is changed', () => {
  const db = openDatabase(fresh(), 1000)

  migrate(db, [FIRST, SECOND])

  assert.equal(migrate(db, [FIRST]), false)
  assert.equal(schemaVersion(db), 2)
  assert.deepEqual({ ...db.prepare("SELECT COUNT(*) AS columns FROM pragma_table_info('notes')").get() }, { columns: 3 })
  db.close()
})

test('a migration that fails leaves the database at the version it had', () => {
  const db = openDatabase(fresh(), 1000)

  assert.throws(() => migrate(db, [FIRST, 'CREATE TABLE other (id INTEGER); THIS IS NOT SQL']))
  assert.equal(schemaVersion(db), 0)
  assert.equal(migrate(db, [FIRST]), true, 'and it can be migrated again')
  db.close()
})

test('a transaction that throws leaves nothing behind, and one that ends is kept', () => {
  const db = openDatabase(fresh(), 1000)
  const count = () => db.prepare('SELECT COUNT(*) AS notes FROM notes').get()?.notes

  migrate(db, [FIRST])

  assert.throws(
    () =>
      inTransaction(db, () => {
        db.prepare('INSERT INTO notes (text) VALUES (?)').run('lost')

        throw new Error('refused')
      }),
    /refused/,
  )
  assert.equal(count(), 0)
  assert.equal(
    inTransaction(db, () => db.prepare('INSERT INTO notes (text) VALUES (?)').run('kept').changes),
    1,
  )
  assert.equal(count(), 1)
  db.close()
})

test('a writer that cannot have the lock in the time it was given fails, and writes once the other is done', () => {
  const path = fresh()
  const [holder, waiting] = [openDatabase(path, 1000), openDatabase(path, 50)]
  const write = () => inTransaction(waiting, () => waiting.prepare('INSERT INTO notes (text) VALUES (?)').run('second').changes)

  migrate(holder, [FIRST])
  holder.exec('BEGIN IMMEDIATE')

  assert.throws(write, /locked/)

  holder.exec('COMMIT')

  assert.equal(write(), 1)
  holder.close()
  waiting.close()
})
