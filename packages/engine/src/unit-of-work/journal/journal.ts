import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
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

// What a session was last told of Weaver's own failures: when each notice was given, and a failed end of task not yet
// told to its agent.
interface Notices {
  readonly sent: Readonly<Record<string, string>>
  readonly stopFailure: string | null
}

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

  tail(name: string, offset: number): { events: JournalEvent[]; offset: number } {
    const fd = openSync(join(this.dir, name), 'r')

    try {
      const buffer = Buffer.alloc(Math.max(0, fstatSync(fd).size - offset))
      const read = readSync(fd, buffer, 0, buffer.length, offset)
      const end = buffer.subarray(0, read).lastIndexOf(10) + 1

      return { events: this.parseLines(buffer.subarray(0, end).toString('utf8')), offset: offset + end }
    } finally {
      closeSync(fd)
    }
  }

  readSession(session: string | null): JournalEvent[] {
    const path = join(this.dir, `${this.logName(session)}.jsonl`)

    return existsSync(path) ? this.parseLines(readFileSync(path, 'utf8')) : []
  }

  // False when the same notice was given to the same side since `since`. What a session was told is kept in a small
  // file beside its log: hooks read it on every call, where the log may be megabytes.
  notify(source: EventSource, body: Extract<EventBody, { kind: 'notification' }>, since: string): boolean {
    mkdirSync(this.dir, { recursive: true })

    const lock = join(this.dir, `${this.logName(source.session)}.notice-lock`)
    const deadline = Date.now() + 1000

    for (;;) {
      try {
        writeFileSync(lock, '', { flag: 'wx' })
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || Date.now() >= deadline) throw error
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
      }
    }

    try {
      const notices = this.noticesOf(source.session)
      const key = [body.event, body.channel, body.message].join('\n')
      const told = (notices.sent[key] ?? '') > since
      const sent = Object.fromEntries(Object.entries(notices.sent).filter(([, at]) => at > since))
      // A failed end of task is told to the owner at once, and to the agent at its next request or call.
      const stopFailure = body.event !== 'Stop' ? notices.stopFailure : body.channel === 'owner' ? body.message : null

      if (!told) sent[key] = new Date().toISOString()
      writeFileSync(this.noticesFile(source.session), JSON.stringify({ sent, stopFailure }))
      if (told) return false
      this.append(source, body)

      return true
    } finally {
      rmSync(lock, { force: true })
    }
  }

  // The failure of an end of task the agent of the session has not been told of yet.
  untoldStopFailure(session: string | null): string | null {
    return this.noticesOf(session).stopFailure
  }

  private noticesOf(session: string | null): Notices {
    const file = this.noticesFile(session)

    if (!existsSync(file)) return { sent: {}, stopFailure: null }

    try {
      return JSON.parse(readFileSync(file, 'utf8')) as Notices
    } catch {
      return { sent: {}, stopFailure: null }
    }
  }

  private noticesFile(session: string | null): string {
    return join(this.dir, `${this.logName(session)}.notices.json`)
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
        const kept = JSON.parse(line) as { readonly kind?: unknown; readonly at?: unknown } | null

        if (kept === null || typeof kept.kind !== 'string' || typeof kept.at !== 'string') return []

        return [{ weaver: UNKNOWN_WEAVER, ...SINCE_ADDED[kept.kind], ...kept } as JournalEvent]
      } catch {
        return []
      }
    })
  }
}
