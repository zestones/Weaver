import { foldHeading, headingsOf } from '../../lib/text/headings.ts'

export interface FinishFields {
  readonly headings: readonly string[] | null
  readonly skill: string | null
}

export class FinishPolicy {
  readonly headings: readonly string[] | null
  readonly skill: string | null

  constructor(fields: FinishFields) {
    this.headings = fields.headings
    this.skill = fields.skill
  }

  declaresFinished(message: string | null): boolean {
    if (this.headings === null) return true
    if (message === null) return false

    const found = headingsOf(message)

    return this.headings.every((heading) => found.has(foldHeading(heading)))
  }

  // An agent that stops without the headings may be waiting for its owner, or may not know how the project ends a task.
  reminder(): string {
    const sections = (this.headings ?? []).map((heading) => `## ${heading}`).join(', ')
    const guide = this.skill === null ? '' : ` How to write them is in ${this.skill}.`

    return `[weaver] This unit of work has changed files, and your last message does not end it. If the work is finished, end with a message that has these sections: ${sections}.${guide} If you are waiting for the owner, say so and stop: this is said once.`
  }
}
