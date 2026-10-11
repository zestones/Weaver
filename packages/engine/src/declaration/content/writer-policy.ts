export interface WriterFields {
  readonly runtime: 'claude' | 'codex'
  readonly model: string | null
  readonly effort: string | null
  readonly timeoutSeconds: number
  readonly skill: string | null
  readonly sections: readonly string[]
}

export class WriterPolicy {
  // The body of a card when the project lists no sections of its own.
  static readonly SECTIONS: readonly string[] = ['Observation', 'Context', 'Trace', 'Uncertainties']

  readonly runtime: 'claude' | 'codex'
  readonly model: string | null
  readonly effort: string | null
  // The writer has a limit of time and none of cost.
  readonly timeoutSeconds: number
  readonly skill: string | null
  readonly sections: readonly string[]

  constructor(fields: WriterFields) {
    this.runtime = fields.runtime
    this.model = fields.model
    this.effort = fields.effort
    this.timeoutSeconds = fields.timeoutSeconds
    this.skill = fields.skill
    this.sections = fields.sections
  }
}
