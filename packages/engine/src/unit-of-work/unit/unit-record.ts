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
  // The agent was told how to end the work, for the request in progress.
  readonly reminded: boolean
  // The contents whose review sent the agent back, for the request in progress.
  readonly reviewed: readonly string[]
  // The content whose review is still running.
  readonly reviewing: string | null
}

export interface UnitRecord {
  readonly number: number
  readonly openedAt: string
  readonly files: Readonly<Record<string, UnitFile>>
  readonly intents: readonly Intent[]
  readonly check: CheckProgress
  readonly unattributed: readonly string[]
}
