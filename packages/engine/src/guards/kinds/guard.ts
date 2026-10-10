import type { ToolCall } from '../../agents/tool-calls/tool-call.ts'
import { Refusal } from '../results/refusal.ts'

export interface GuardFields {
  readonly id: string
  readonly rule: string
  readonly statement: string
}

// Up front, only what is certain is refused: a call that names what a rule forbids. What a call does not name, such as
// a script that writes a guarded file, is not seen here.
export abstract class Guard {
  readonly id: string
  private readonly rule: string
  private readonly statement: string

  constructor(fields: GuardFields) {
    this.id = fields.id
    this.rule = fields.rule
    this.statement = fields.statement
  }

  abstract refusal(call: ToolCall): Refusal | null

  protected refuse(what: string): Refusal {
    return new Refusal({ guard: this.id, rule: this.rule, statement: this.statement, what })
  }
}
