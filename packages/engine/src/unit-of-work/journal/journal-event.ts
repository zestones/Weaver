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

// A call a guard would have refused, let through by the owner's maintenance.
interface LiftEvent {
  readonly kind: 'lift'
  readonly tool: string
  readonly guard: string
  readonly what: string
}

interface MaintenanceEvent {
  readonly kind: 'maintenance'
  readonly on: boolean
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

interface FlagEvent {
  readonly kind: 'flag'
  readonly unit: number
  readonly card: number
  // The registry already held this flag: the same call seen again, or the same words in the same unit of work.
  readonly known: boolean
}

export type EventBody =
  | TouchEvent
  | CheckEvent
  | SettleEvent
  | HeadMovedEvent
  | RefuseEvent
  | LiftEvent
  | MaintenanceEvent
  | ReviewEvent
  | AnswerEvent
  | FlagEvent
export type JournalEvent = EventBase & EventBody
export type EventOf<Kind extends EventBody['kind']> = Extract<JournalEvent, { kind: Kind }>
