import type { EventBody } from '../../unit-of-work/journal/journal-event.ts'

export interface RefusalFields {
  readonly guard: string
  readonly rule: string
  readonly statement: string
  readonly what: string
}

export class Refusal {
  readonly guard: string
  readonly rule: string
  readonly what: string
  private readonly statement: string

  constructor(fields: RefusalFields) {
    this.guard = fields.guard
    this.rule = fields.rule
    this.what = fields.what
    this.statement = fields.statement
  }

  get reason(): string {
    return `[weaver ${this.rule}] ${this.what} is refused by the guard ${this.guard}. ${this.statement}`
  }

  event(tool: string): EventBody {
    return { kind: 'refuse', tool, guard: this.guard, rule: this.rule, what: this.what }
  }
}
