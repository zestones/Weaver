import type { DatabaseSync } from 'node:sqlite'
import { isAlive } from '../lib/process/alive.ts'

// One writer at a time in a repository: two of them would write up the same flags.
export class WriterTurn {
  private readonly db: DatabaseSync

  constructor(db: DatabaseSync) {
    this.db = db
  }

  // A writer that died without leaving holds nothing.
  take(pid: number): boolean {
    const holder = this.db.prepare('SELECT pid FROM writer_turn').get()?.pid

    if (typeof holder === 'number' && holder !== pid && isAlive(holder)) return false

    this.db.prepare('INSERT INTO writer_turn (slot, pid) VALUES (1, ?) ON CONFLICT (slot) DO UPDATE SET pid = excluded.pid').run(pid)

    return true
  }

  leave(pid: number): void {
    this.db.prepare('DELETE FROM writer_turn WHERE pid = ?').run(pid)
  }
}
