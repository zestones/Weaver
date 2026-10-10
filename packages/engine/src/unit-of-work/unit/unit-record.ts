import type { Blob } from '../../lib/git/repository.ts'

export interface Intent {
  readonly at: string
  readonly source: 'prompt'
  readonly text: string
  readonly answering: string | null
}

export interface UnitFile {
  // What it held before the session first touched it, and what the session last left in it.
  readonly base: Blob
  readonly last: Blob
  readonly foreign: boolean
  readonly touchedAt: string
}

interface CheckProgress {
  readonly rounds: number
  readonly result: 'pass' | 'fail' | null
}

export interface UnitRecord {
  readonly number: number
  readonly openedAt: string
  readonly files: Readonly<Record<string, UnitFile>>
  readonly intents: readonly Intent[]
  readonly check: CheckProgress
  readonly unattributed: readonly string[]
}
