import { DatabaseSync } from 'node:sqlite'

export function openDatabase(path: string, busyTimeoutMs: number): DatabaseSync {
  const db = new DatabaseSync(path, { timeout: busyTimeoutMs })

  try {
    // A rollback journal keeps the whole database in one file to copy, which a write-ahead log does not.
    db.exec('PRAGMA journal_mode = DELETE')
  } catch (error) {
    db.close()

    throw error
  }

  return db
}

export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get()

  return typeof row?.user_version === 'number' ? row.user_version : 0
}

// The write lock is taken at once: two processes that write wait for each other, where a lock taken at the first
// write would make one of them fail.
export function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE')

  try {
    const result = work()

    db.exec('COMMIT')

    return result
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')

    throw error
  }
}

// Each migration brings the schema one version further, and `user_version` counts the ones applied. false, with
// nothing changed, when the database is already past the last one: newer code wrote it.
export function migrate(db: DatabaseSync, migrations: readonly string[]): boolean {
  const found = schemaVersion(db)

  if (found >= migrations.length) return found === migrations.length

  return inTransaction(db, () => {
    // Read again under the lock: another process may have migrated in between.
    const from = schemaVersion(db)

    if (from > migrations.length) return false

    for (const migration of migrations.slice(from)) db.exec(migration)

    db.exec(`PRAGMA user_version = ${String(migrations.length)}`)

    return true
  })
}
