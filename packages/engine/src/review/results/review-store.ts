import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReviewRecord } from './review-record.ts'

// The reviews of a session, each under the content of the unit it judged. The hook that asks a review and the process
// that runs it both read and write here, so a record is replaced in one move.
export class ReviewStore {
  private readonly dir: string

  constructor(sessionDir: string) {
    this.dir = join(sessionDir, 'reviews')
  }

  find(content: string): ReviewRecord | null {
    const path = join(this.dir, `${content}.json`)

    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as ReviewRecord) : null
  }

  keep(content: string, record: ReviewRecord): void {
    const path = join(this.dir, `${content}.json`)

    mkdirSync(this.dir, { recursive: true })
    writeFileSync(`${path}.${String(process.pid)}.tmp`, JSON.stringify(record, null, 2))
    renameSync(`${path}.${String(process.pid)}.tmp`, path)
  }
}
