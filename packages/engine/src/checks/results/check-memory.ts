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

  constructor(dir: string) {
    this.path = join(dir, 'checks.json')
  }

  recall(check: Check, unit: UnitDiff): CheckOutcome | null {
    const kept = this.load()[check.id]

    if (kept?.key !== this.key(check, unit)) return null

    return new CheckOutcome({ ...kept.outcome, keptFrom: kept.at })
  }

  keep(check: Check, unit: UnitDiff, outcome: CheckOutcome): void {
    if (!outcome.isVerdict) return

    const kept: Kept = { key: this.key(check, unit), at: new Date().toISOString(), outcome: outcome.fields }

    mkdirSync(dirname(this.path), { recursive: true })
    const draft = `${this.path}.${String(process.pid)}.tmp`

    writeFileSync(draft, JSON.stringify({ ...this.load(), [check.id]: kept }, null, 2))
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
