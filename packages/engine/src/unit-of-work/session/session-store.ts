import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { UnitOfWork } from '../unit/unit-of-work.ts'
import type { SessionRecord } from './session-record.ts'

export interface Transaction<Value> {
  readonly record: SessionRecord
  readonly value: Value
}

const VERSION = 7
const LOCK_WAIT_MS = 5000
const LOCK_POLL_MS = 20

export class SessionStore {
  private readonly path: string
  private readonly lock: string
  private readonly agent: string

  constructor(dir: string, agent: string) {
    this.path = join(dir, 'state.json')
    this.lock = join(dir, 'state.lock')
    this.agent = agent
  }

  load(): SessionRecord | null {
    if (!existsSync(this.path)) return null

    const record = JSON.parse(readFileSync(this.path, 'utf8')) as Partial<SessionRecord>

    return record.version === VERSION ? (record as SessionRecord) : null
  }

  // When the state last changed, which is when the session was last seen at work; null without a state.
  changedAt(): Date | null {
    return existsSync(this.path) ? statSync(this.path).mtime : null
  }

  transact<Value>(change: (record: SessionRecord) => Transaction<Value>): Transaction<Value> {
    this.acquire()

    try {
      const result = change(this.load() ?? this.fresh())

      this.save(result.record)

      return result
    } finally {
      rmSync(this.lock, { force: true })
    }
  }

  update(change: (record: SessionRecord) => SessionRecord): SessionRecord {
    return this.transact((record) => ({ record: change(record), value: null })).record
  }

  private fresh(): SessionRecord {
    return {
      version: VERSION,
      agent: this.agent,
      unit: UnitOfWork.fresh(1).record,
      pending: {},
      lastReply: null,
      failedReview: null,
      head: null,
      flagged: [],
      maintenance: null,
      asked: null,
      background: {},
    }
  }

  private save(record: SessionRecord): void {
    writeFileSync(`${this.path}.tmp`, JSON.stringify(record, null, 2))
    renameSync(`${this.path}.tmp`, this.path)
  }

  // A holder that takes longer than any hook should has died: its lock is taken over.
  private acquire(): void {
    const deadline = Date.now() + LOCK_WAIT_MS

    for (;;) {
      try {
        writeFileSync(this.lock, String(process.pid), { flag: 'wx' })

        return
      } catch {
        if (Date.now() > deadline) rmSync(this.lock, { force: true })
        else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_POLL_MS)
      }
    }
  }
}
