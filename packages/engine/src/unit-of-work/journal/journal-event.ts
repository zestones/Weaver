export interface EventSource {
  readonly session: string | null
  readonly agent: string | null
}

interface EventBase extends EventSource {
  readonly v: number
  readonly at: string
  // The version of the Weaver that wrote the line.
  readonly weaver: string
}

// How one check ended, at the end of a task or right after a call. The three counts are those of its findings: the
// ones that hold the task, the ones that wait for the owner, the ones listed for the reviewer.
export interface CheckRun {
  readonly id: string
  readonly status: 'pass' | 'fail' | 'timeout' | 'skip'
  readonly ms: number
  readonly failures: number
  readonly toValidate: number
  readonly candidates: number
  // A verdict given again: nothing the check reads changed since it ran. Older lines leave it out.
  readonly kept?: boolean
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
  // The lines the unit added, and the files a repair rewrote before the checks judged.
  readonly lines: number
  readonly repaired: number
  readonly ms: number
  readonly checks: readonly CheckRun[]
}

// Checks run on demand, by `weaver check`, in the middle of a task: the unit of work of the agent that asked, or null
// for the owner's own changes, which are judged against HEAD.
interface AskedEvent {
  readonly kind: 'asked'
  readonly unit: number | null
  readonly passed: boolean
  readonly failed: readonly string[]
  readonly files: number
  readonly ms: number
  readonly checks: readonly CheckRun[]
}

// What the checks that warn did right after one call: `warned` names the ones that told the agent something.
interface WarnEvent {
  readonly kind: 'warn'
  readonly tool: string
  readonly files: number
  readonly ms: number
  readonly checks: readonly CheckRun[]
  readonly warned: readonly string[]
}

// One run of the hook, from the start of its process to its answer: what supervision costs the agent.
interface HookEvent {
  readonly kind: 'hook'
  readonly event: string
  readonly tool: string | null
  // The subagent that made the call. Its session is the one of its parent.
  readonly subagent: string | null
  readonly ms: number
}

// One end of turn: whether the agent said its task was finished, and what kept it from stopping, if anything did.
interface TurnEvent {
  readonly kind: 'turn'
  readonly unit: number
  readonly finished: boolean
  readonly held: 'checks' | 'review' | 'reminder' | null
}

// What the owner asked, as the unit of work keeps it, and where the runtime writes the transcript of the session.
interface RequestEvent {
  readonly kind: 'request'
  readonly unit: number
  readonly text: string
  readonly directives: readonly string[]
  readonly transcript: string | null
}

// Weaver could not do its work: a hook that failed, or a configuration it could not read.
interface ErrorEvent {
  readonly kind: 'error'
  readonly event: string
  readonly message: string
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
  readonly model: string | null
  // Why this runtime reviewed, or why no review was run.
  readonly reason: string
  readonly standing: string
  // How many rules the reviewer was given to judge.
  readonly rules: number
  readonly findings: number
  // The rule of each finding, in the order of the findings.
  readonly findingRules: readonly string[]
  readonly suspicions: number
  readonly dropped: number
  readonly experiments: number
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

interface NoteEvent {
  readonly kind: 'note'
  readonly unit: number
  readonly card: number
  // What the note concludes of its card; null when it concludes nothing.
  readonly conclusion: string | null
}

export type EventBody =
  | TouchEvent
  | CheckEvent
  | AskedEvent
  | WarnEvent
  | HookEvent
  | TurnEvent
  | RequestEvent
  | ErrorEvent
  | SettleEvent
  | HeadMovedEvent
  | RefuseEvent
  | LiftEvent
  | MaintenanceEvent
  | ReviewEvent
  | AnswerEvent
  | FlagEvent
  | NoteEvent
export type JournalEvent = EventBase & EventBody
export type EventOf<Kind extends EventBody['kind']> = Extract<JournalEvent, { kind: Kind }>
