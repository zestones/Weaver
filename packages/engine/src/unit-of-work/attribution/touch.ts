import type { EventBody } from '../journal/journal-event.ts'
import type { Change, HeadMove } from './attribution-window.ts'

export interface TouchFields {
  readonly tool: string
  readonly changes: ReadonlyMap<string, Change>
  readonly shown: readonly string[]
  readonly foreign: readonly string[]
  readonly headMoved: HeadMove | null
}

export class Touch {
  readonly tool: string
  // The files the call changed and that are the session's own, each with what it held before and what it holds now.
  readonly changes: ReadonlyMap<string, Change>
  readonly shown: readonly string[]
  readonly foreign: readonly string[]
  readonly headMoved: HeadMove | null

  constructor(fields: TouchFields) {
    this.tool = fields.tool
    this.changes = fields.changes
    this.shown = fields.shown
    this.foreign = fields.foreign
    this.headMoved = fields.headMoved
  }

  get paths(): string[] {
    return [...this.changes.keys()]
  }

  events(): EventBody[] {
    const { tool, paths, shown, foreign, headMoved } = this
    const touched: EventBody[] = paths.length + shown.length > 0 ? [{ kind: 'touch', tool, paths, foreign, unattributed: shown }] : []

    return headMoved === null ? touched : [...touched, { kind: 'head-moved', tool, ...headMoved }]
  }
}
