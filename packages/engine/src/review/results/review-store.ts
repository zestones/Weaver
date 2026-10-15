import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReviewRecord } from './review-record.ts'

const WAITER = '.waiter'

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
    this.replace(join(this.dir, `${content}.json`), JSON.stringify(record, null, 2))
  }

  // The end of turn that waits for a review is named beside it, apart from the record that its reviewer rewrites.
  wait(content: string, pid: number): void {
    this.replace(this.waiterPath(content), String(pid))
  }

  waiter(content: string): number | null {
    try {
      const pid = Number(readFileSync(this.waiterPath(content), 'utf8'))

      return Number.isInteger(pid) && pid > 0 ? pid : null
    } catch {
      return null
    }
  }

  stopWaiting(content: string, pid: number): void {
    if (this.waiter(content) === pid) rmSync(this.waiterPath(content), { force: true })
  }

  // A message of the owner takes the turn from the end of turn that waits: the review goes on, waited for by no one.
  releaseAll(): void {
    if (!existsSync(this.dir)) return

    for (const name of readdirSync(this.dir).filter((entry) => entry.endsWith(WAITER))) rmSync(join(this.dir, name), { force: true })
  }

  private waiterPath(content: string): string {
    return join(this.dir, `${content}${WAITER}`)
  }

  private replace(path: string, text: string): void {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(`${path}.${String(process.pid)}.tmp`, text)
    renameSync(`${path}.${String(process.pid)}.tmp`, path)
  }
}
