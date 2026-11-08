import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Repository } from '../../lib/git/repository.ts'
import type { EventOf, JournalEvent } from './journal-event.ts'
import { Journal } from './journal.ts'

interface ReadJournal {
  readonly offset: number
  readonly size: number
  readonly mtime: number
  readonly inode: number
  readonly events: readonly JournalEvent[]
}

export class JournalHistory {
  readonly journal: Journal
  private readonly files = new Map<string, ReadJournal>()

  constructor(repo: Repository) {
    this.journal = new Journal(repo)
  }

  recentErrors(now = Date.now()): EventOf<'error'>[] {
    const since = now - 7 * 24 * 60 * 60 * 1000

    return this.read().filter(
      (event): event is EventOf<'error'> => event.kind === 'error' && Date.parse(event.at) >= since && Date.parse(event.at) <= now,
    )
  }

  authorHook(runtime: string): EventOf<'hook'> | null {
    return (
      this.read().findLast(
        (event): event is EventOf<'hook'> => event.kind === 'hook' && event.agent === runtime && (event.subagent ?? null) === null,
      ) ?? null
    )
  }

  private read(): JournalEvent[] {
    const dir = this.journal.dir
    const names = existsSync(dir) ? readdirSync(dir).filter((file) => file.endsWith('.jsonl')) : []

    for (const name of this.files.keys()) if (!names.includes(name)) this.files.delete(name)
    for (const name of names) {
      const stat = statSync(join(dir, name))
      const previous = this.files.get(name)

      if (previous?.size === stat.size && previous.mtime === stat.mtimeMs && previous.inode === stat.ino) continue

      const append = previous !== undefined && previous.inode === stat.ino && stat.size > previous.size
      const tail = this.journal.tail(name, append ? previous.offset : 0)

      this.files.set(name, {
        ...tail,
        size: stat.size,
        mtime: stat.mtimeMs,
        inode: stat.ino,
        events: [...(append ? previous.events : []), ...tail.events],
      })
    }

    return [...this.files.values()].flatMap((file) => file.events).sort((left, right) => left.at.localeCompare(right.at))
  }
}
