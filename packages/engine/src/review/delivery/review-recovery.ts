import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CardRegistry } from '@weaver/memory'
import type { Repository } from '../../lib/git/repository.ts'
import { isAlive } from '../../lib/process/alive.ts'
import type { ReviewRecord } from '../results/review-record.ts'
import { ReviewStore } from '../results/review-store.ts'
import { ReviewDelivery } from './review-delivery.ts'

interface SessionPointers {
  readonly unit?: {
    readonly number?: number
    readonly check?: { readonly reviewing?: string | null; readonly reviewed?: readonly string[] }
  }
}

export class ReviewRecovery {
  private readonly repo: Repository

  constructor(repo: Repository) {
    this.repo = repo
  }

  run(): void {
    const root = join(this.repo.gitDir, 'weaver', 'sessions')
    if (!existsSync(root)) return
    const registry = new CardRegistry(this.repo.stateDir)
    try {
      const after = registry.recoveryPosition(root)
      const ids = readdirSync(root)
        .sort()
        .filter((id) => id > after)
        .slice(0, 20)
      for (const id of ids) {
        const dir = join(root, id)
        const path = join(dir, 'state.json')
        if (existsSync(path)) {
          const state = this.state(path)
          const store = new ReviewStore(dir)
          const contents = [...new Set([...(state.unit?.check?.reviewed ?? []), state.unit?.check?.reviewing])].filter(
            (content): content is string => typeof content === 'string',
          )
          const offset = Number(registry.recoveryPosition(dir)) || 0
          for (const content of contents.slice(offset, offset + 5)) {
            const record = this.review(store, content)
            const waiter = store.waiter(content)
            if (record !== null && (waiter === null || !isAlive(waiter)))
              new ReviewDelivery(this.repo).finished(record.origin?.session ?? id, content, {
                ...record,
                origin: record.origin ?? {
                  author: record.assignment.runtime,
                  role: 'reviewer',
                  session: id,
                  subagent: null,
                  unit: state.unit?.number ?? null,
                  requests: record.request.requests,
                  commit: record.head,
                  at: record.startedAt,
                },
              })
          }
          registry.recoveredThrough(dir, offset + 5 >= contents.length ? '0' : String(offset + 5))
        }
        registry.recoveredThrough(root, id)
      }
      if (ids.length < 20) registry.recoveredThrough(root, '')
    } finally {
      registry.close()
    }
  }

  private state(path: string): SessionPointers {
    try {
      return (JSON.parse(readFileSync(path, 'utf8')) as SessionPointers | null) ?? {}
    } catch {
      return {}
    }
  }

  private review(store: ReviewStore, content: string): ReviewRecord | null {
    try {
      return store.find(content)
    } catch {
      return null
    }
  }
}
