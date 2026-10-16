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
  // When the session first saw it, which a call that started earlier may move back.
  readonly since: string
}

// A file the session wrote back to what it held before: out of the unit, but its base is still known.
export interface ReturnedFile {
  readonly base: Blob
  readonly since: string
}

// A call a guard would have refused, which the owner's maintenance let through.
export interface LiftedCall {
  readonly guard: string
  readonly what: string
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

// The cards of the owner the unit of work is about: those its agent read, and those whose files its calls changed.
export interface UnitCards {
  readonly concerned: readonly number[]
  // Those its agent wrote a note on.
  readonly noted: readonly number[]
  // Those the end of the task already asked a note for.
  readonly asked: readonly number[]
}

export interface UnitRecord {
  readonly number: number
  readonly openedAt: string
  readonly files: Readonly<Record<string, UnitFile>>
  readonly intents: readonly Intent[]
  readonly check: CheckProgress
  readonly unattributed: readonly string[]
  readonly lifted: readonly LiftedCall[]
  readonly returned: Readonly<Record<string, ReturnedFile>>
  readonly cards: UnitCards
}
