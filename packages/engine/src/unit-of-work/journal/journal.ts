import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import type { Repository } from '../../lib/git/repository.ts'
import type { EventBody, EventSource, JournalEvent } from './journal-event.ts'

const SCHEMA_VERSION = 1
const REPO_LOG = 'repo'

export class Journal {
  private readonly dir: string

  constructor(repo: Repository) {
    this.dir = join(repo.stateDir, 'events')
  }

  append(source: EventSource, body: EventBody, at = new Date().toISOString()): JournalEvent {
    const event: JournalEvent = { v: SCHEMA_VERSION, at, ...source, ...body }

    mkdirSync(this.dir, { recursive: true })

    const fd = openSync(join(this.dir, `${this.logName(source.session)}.jsonl`), 'a')

    try {
      this.writeAll(fd, Buffer.from(`${JSON.stringify(event)}\n`))
    } finally {
      closeSync(fd)
    }

    return event
  }

  read(): JournalEvent[] {
    if (!existsSync(this.dir)) return []

    return readdirSync(this.dir)
      .filter((name) => name.endsWith('.jsonl'))
      .flatMap((name) => this.parseLines(readFileSync(join(this.dir, name), 'utf8')))
      .sort((left, right) => left.at.localeCompare(right.at))
  }

  private logName(session: string | null): string {
    return session === null ? REPO_LOG : session.replace(/[^\w.-]/g, '_')
  }

  private writeAll(fd: number, bytes: Buffer): void {
    let written = 0

    while (written < bytes.length) written += writeSync(fd, bytes, written)
  }

  // A line cut short by a crash is skipped: the journal stays readable.
  private parseLines(text: string): JournalEvent[] {
    return text.split('\n').flatMap((line) => {
      if (line.trim() === '') return []

      try {
        return [JSON.parse(line) as JournalEvent]
      } catch {
        return []
      }
    })
  }
}
