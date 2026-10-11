import type { FlagRecord, Place } from '../flags/flag-record.ts'

export type CardOrigin = 'flag' | 'finding' | 'suspicion' | 'owner'
// raw: a flag no writer has written up. merged: the same thing as another card, kept as its occurrence.
export type CardState = 'raw' | 'open' | 'closed' | 'merged'
export type Closing = 'fixed' | 'wontfix' | 'issue'

export interface Provenance {
  // 'claude', 'codex' or 'owner'.
  readonly author: string
  readonly role: 'author' | 'reviewer' | 'owner'
  readonly session: string | null
  // The id of the subagent that made the call, when one did.
  readonly subagent: string | null
  readonly unit: number | null
  // What the owner asked for, in the unit of work the thing was found in.
  readonly requests: readonly string[]
  readonly commit: string | null
  readonly at: string
}

// What a review left: a finding its author did not fix, or a suspicion of the reviewer.
export interface ReviewContent {
  // The name of the point in its review, such as `3f9a2c1/F1`.
  readonly review: string
  readonly rule: string | null
  readonly statement: string | null
  readonly message: string
  readonly quote: string | null
  readonly suggestion: string | null
  readonly evidence: string | null
  // Why it waits for the owner.
  readonly standing: string
}

export interface WriterLook {
  readonly verdict: 'agrees' | 'contradicts' | 'cannot-tell'
  readonly note: string
}

export interface WrittenCard {
  readonly title: string
  // family -> values, all of them declared by the project.
  readonly labels: Readonly<Record<string, readonly string[]>>
  readonly sections: readonly { readonly name: string; readonly text: string }[]
  readonly look: WriterLook
  // The time and the cost are those of the task that wrote it, which may have written several cards.
  readonly writer: {
    readonly runtime: string
    readonly model: string | null
    readonly seconds: number
    readonly costUsd: number | null
  }
  readonly at: string
}

export interface CardClosing {
  readonly as: Closing
  readonly reason: string | null
  // What the command that files an issue printed, for `issue`.
  readonly issue: string | null
  readonly at: string
}

export interface Occurrence {
  // The card that turned out to be the same thing; null when the same flag or finding simply came again.
  readonly card: number | null
  readonly provenance: Provenance
  readonly note: string
}

export interface CardEvent {
  readonly at: string
  readonly action:
    | 'flagged'
    | 'opened'
    | 'written'
    | 'writing-failed'
    | 'closed'
    | 'reopened'
    | 'corrected'
    | 'seen-again'
    | 'tied'
    | 'untied'
    | 'merged'
    | 'separated'
  readonly note: string | null
}

export interface CardRecord {
  readonly number: number
  readonly origin: CardOrigin
  readonly state: CardState
  readonly places: readonly Place[]
  readonly provenance: Provenance
  // For a card that comes from a flag, of an agent or of the owner.
  readonly flag: FlagRecord | null
  // For a card that comes from a review.
  readonly review: ReviewContent | null
  // What the writer made of the flag; null while raw, and for a card that comes from a review.
  readonly written: WrittenCard | null
  readonly closing: CardClosing | null
  // Room for a closing an agent proposes and the owner accepts. Nothing writes it yet.
  readonly proposal: { readonly as: Closing; readonly reason: string; readonly by: Provenance } | null
  readonly seenSinceClosing: boolean
  readonly occurrences: readonly Occurrence[]
  readonly ties: readonly number[]
  readonly mergedInto: number | null
  readonly writing: { readonly attempts: number; readonly failure: string | null }
  readonly history: readonly CardEvent[]
}
