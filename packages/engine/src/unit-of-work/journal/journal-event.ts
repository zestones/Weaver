export interface EventSource {
  readonly session: string | null
  readonly agent: string | null
}

interface EventBase extends EventSource {
  readonly v: number
  readonly at: string
}

interface TouchEvent {
  readonly kind: 'touch'
  readonly tool: string
  readonly paths: readonly string[]
  readonly foreign: readonly string[]
  readonly unattributed: readonly string[]
}

interface CheckEvent {
  readonly kind: 'check'
  readonly unit: number
  readonly round: number
  readonly passed: boolean
  readonly failed: readonly string[]
  readonly toValidate: number
  readonly files: number
  readonly ms: number
}

interface SettleEvent {
  readonly kind: 'settle'
  readonly unit: number
  readonly files: number
  readonly by: 'check' | 'owner'
  readonly notes: readonly string[]
}

interface HeadMovedEvent {
  readonly kind: 'head-moved'
  readonly tool: string
  readonly from: string | null
  readonly to: string | null
}

interface RefuseEvent {
  readonly kind: 'refuse'
  readonly tool: string
  readonly guard: string
  readonly what: string
}

interface ReviewEvent {
  readonly kind: 'review'
  readonly unit: number
  readonly runtime: string
  // Why this runtime reviewed, or why no review was run.
  readonly reason: string
  readonly standing: string
  readonly findings: number
  readonly suspicions: number
  readonly dropped: number
  readonly failure: string | null
  readonly seconds: number
  readonly costUsd: number | null
}

interface AnswerEvent {
  readonly kind: 'answer'
  readonly unit: number
  readonly finding: number
  readonly rule: string
  readonly status: 'fixed' | 'not-fixed' | 'missing'
}

export type EventBody = TouchEvent | CheckEvent | SettleEvent | HeadMovedEvent | RefuseEvent | ReviewEvent | AnswerEvent
export type JournalEvent = EventBase & EventBody
export type EventOf<Kind extends EventBody['kind']> = Extract<JournalEvent, { kind: Kind }>
