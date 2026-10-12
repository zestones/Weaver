import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import type { Repository } from '../../lib/git/repository.ts'
import { EngineManifest } from './engine-manifest.ts'
import type { EventBody, EventSource, JournalEvent } from './journal-event.ts'

// The second shape of the lines: each says which Weaver wrote it, a verdict holds each of its checks, and how the hook
// ran, what was asked, each end of turn and each warning are kept.
const SCHEMA_VERSION = 2
const REPO_LOG = 'repo'
// The journal is never rewritten: a line an earlier Weaver wrote lacks what was kept since, and is read with nothing
// there. `v` tells a count that was nothing from one that was not kept.
const SINCE_ADDED: Readonly<Record<string, object>> = {
  check: { lines: 0, repaired: 0, checks: [] },
  review: { model: null, reason: '', standing: 'unknown', rules: 0, findingRules: [], suspicions: 0, dropped: 0, experiments: 0 },
}
const UNKNOWN_WEAVER = 'unknown'

export class Journal {
  // The folder of the journal: one file of lines for each session.
  readonly dir: string
  private weaver: string | null = null

  constructor(repo: Repository) {
    this.dir = join(repo.stateDir, 'events')
  }

  append(source: EventSource, body: EventBody, at = new Date().toISOString()): JournalEvent {
    this.weaver ??= new EngineManifest().version

    const event: JournalEvent = { v: SCHEMA_VERSION, at, weaver: this.weaver, ...source, ...body }

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
        const kept = JSON.parse(line) as { readonly kind: string }

        return [{ weaver: UNKNOWN_WEAVER, ...SINCE_ADDED[kept.kind], ...kept } as JournalEvent]
      } catch {
        return []
      }
    })
  }
}
