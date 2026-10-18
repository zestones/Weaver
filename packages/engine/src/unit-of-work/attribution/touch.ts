import type { EventBody } from '../journal/journal-event.ts'
import type { Change, HeadMove } from './attribution-window.ts'

export interface TouchFields {
  readonly tool: string
  readonly changes: ReadonlyMap<string, Change>
  readonly shown: readonly string[]
  readonly foreign: readonly string[]
  readonly headMoved: HeadMove | null
  readonly others: readonly string[]
}

export class Touch {
  readonly tool: string
  // The files the call changed and that are the session's own, each with what it held before and what it holds now.
  readonly changes: ReadonlyMap<string, Change>
  readonly shown: readonly string[]
  readonly foreign: readonly string[]
  readonly headMoved: HeadMove | null
  // Among its changes, the files another call of the session wrote while this one ran, as subagents side by side do:
  // the unit holds them all, and that call is the one told of them.
  readonly others: readonly string[]

  constructor(fields: TouchFields) {
    this.tool = fields.tool
    this.changes = fields.changes
    this.shown = fields.shown
    this.foreign = fields.foreign
    this.headMoved = fields.headMoved
    this.others = fields.others
  }

  get paths(): string[] {
    return [...this.changes.keys()]
  }

  // What the call itself changed, as it is told to the agent that made it.
  get own(): Map<string, Change> {
    return new Map([...this.changes].filter(([path]) => !this.others.includes(path)))
  }

  events(): EventBody[] {
    const { tool, paths, shown, foreign, headMoved } = this
    const touched: EventBody[] = paths.length + shown.length > 0 ? [{ kind: 'touch', tool, paths, foreign, unattributed: shown }] : []

    return headMoved === null ? touched : [...touched, { kind: 'head-moved', tool, ...headMoved }]
  }
}
