import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Check } from '../kinds/check.ts'
import type { UnitDiff } from '../../unit-of-work/diff/unit-diff.ts'
import { EngineManifest } from '../../unit-of-work/journal/engine-manifest.ts'
import { CheckOutcome, type OutcomeFields } from './check-outcome.ts'

interface Kept {
  readonly key: string
  readonly at: string
  readonly outcome: OutcomeFields
}

type Memory = Readonly<Record<string, Kept>>

// What each check last said, and of what: the same check, given the same two trees, says the same again. Only a verdict
// is kept, a pass or a failure the check gave: one that ran out of time or could not run says nothing of the files.
export class CheckMemory {
  private readonly path: string
  private readonly version = new EngineManifest().version
  private readonly fresh: boolean

  constructor(dir: string, fresh = false) {
    this.path = join(dir, 'checks.json')
    this.fresh = fresh
  }

  recall(check: Check, unit: UnitDiff): CheckOutcome | null {
    if (this.fresh) return null
    const kept = this.load()[check.id]

    if (kept?.key !== this.key(check, unit)) return null

    return new CheckOutcome({ ...kept.outcome, keptFrom: kept.at })
  }

  copyTo(dir: string, checked: readonly string[]): void {
    const destination = new CheckMemory(dir)
    const earlier = Object.fromEntries(Object.entries(destination.load()).filter(([id]) => !checked.includes(id)))
    destination.save({ ...earlier, ...this.load() })
  }

  keep(check: Check, unit: UnitDiff, outcome: CheckOutcome): void {
    if (!outcome.isVerdict) {
      if (this.fresh) this.save(Object.fromEntries(Object.entries(this.load()).filter(([id]) => id !== check.id)))
      return
    }

    const kept: Kept = { key: this.key(check, unit), at: new Date().toISOString(), outcome: outcome.fields }
    this.save({ ...this.load(), [check.id]: kept })
  }

  private save(memory: Memory): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const draft = `${this.path}.${String(process.pid)}.tmp`
    writeFileSync(draft, JSON.stringify(memory, null, 2))
    renameSync(draft, this.path)
  }

  private key(check: Check, unit: UnitDiff): string {
    return createHash('sha1')
      .update(JSON.stringify([this.version, check.fingerprint, unit.base, unit.head]))
      .digest('hex')
  }

  private load(): Memory {
    try {
      return existsSync(this.path) ? (JSON.parse(readFileSync(this.path, 'utf8')) as Memory) : {}
    } catch {
      return {}
    }
  }
}
