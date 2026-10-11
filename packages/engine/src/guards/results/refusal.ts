import type { EventBody } from '../../unit-of-work/journal/journal-event.ts'

export interface RefusalFields {
  readonly guard: string
  readonly statement: string
  readonly what: string
}

export class Refusal {
  readonly guard: string
  readonly what: string
  private readonly statement: string

  constructor(fields: RefusalFields) {
    this.guard = fields.guard
    this.what = fields.what
    this.statement = fields.statement
  }

  get reason(): string {
    return `[weaver ${this.guard}] ${this.what} is refused. ${this.statement}`
  }

  event(tool: string): EventBody {
    return { kind: 'refuse', tool, guard: this.guard, what: this.what }
  }
}
