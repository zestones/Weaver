import type { EventBody } from '../../unit-of-work/journal/journal-event.ts'
import type { LiftedCall } from '../../unit-of-work/unit/unit-record.ts'

export interface RefusalFields {
  readonly guard: string
  readonly statement: string
  readonly liftable: boolean
  readonly what: string
}

export class Refusal {
  readonly guard: string
  readonly what: string
  readonly liftable: boolean
  private readonly statement: string

  constructor(fields: RefusalFields) {
    this.guard = fields.guard
    this.what = fields.what
    this.liftable = fields.liftable
    this.statement = fields.statement
  }

  get reason(): string {
    return `[weaver ${this.guard}] ${this.what} is refused. ${this.statement}`
  }

  // What the agent of a session reads. A guard the owner may lift names the command that does it, for the agent to
  // pass on: it cannot run it.
  told(session: string | null): string {
    return this.liftable && session !== null
      ? `${this.reason} Only the owner lifts the guards, for this session: \`weaver maintenance on ${session}\`.`
      : this.reason
  }

  get lifted(): LiftedCall {
    return { guard: this.guard, what: this.what }
  }

  event(tool: string): EventBody {
    return { kind: 'refuse', tool, guard: this.guard, what: this.what }
  }
}
