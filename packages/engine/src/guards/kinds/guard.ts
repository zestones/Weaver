import type { ToolCall } from '../../agents/tool-calls/tool-call.ts'
import { Refusal } from '../results/refusal.ts'

export interface GuardFields {
  readonly id: string
  readonly statement: string
  // Whether the owner's maintenance lets through what it refuses.
  readonly liftable: boolean
}

// Up front, only what is certain is refused: a call that names what a rule forbids. What a call does not name, such as
// a script that writes a guarded file, is not seen here.
export abstract class Guard {
  readonly id: string
  private readonly statement: string
  private readonly liftable: boolean

  constructor(fields: GuardFields) {
    this.id = fields.id
    this.statement = fields.statement
    this.liftable = fields.liftable
  }

  abstract refusal(call: ToolCall): Refusal | null

  protected refuse(what: string): Refusal {
    return new Refusal({ guard: this.id, statement: this.statement, liftable: this.liftable, what })
  }
}
