import type { EventBody } from '../journal/journal-event.ts'
import type { HeadMove } from './attribution-window.ts'

export interface TouchFields {
  readonly tool: string
  readonly paths: readonly string[]
  readonly shown: readonly string[]
  readonly foreign: readonly string[]
  readonly headMoved: HeadMove | null
}

export class Touch {
  readonly tool: string
  readonly paths: readonly string[]
  readonly shown: readonly string[]
  readonly foreign: readonly string[]
  readonly headMoved: HeadMove | null

  constructor(fields: TouchFields) {
    this.tool = fields.tool
    this.paths = fields.paths
    this.shown = fields.shown
    this.foreign = fields.foreign
    this.headMoved = fields.headMoved
  }

  events(): EventBody[] {
    const { tool, paths, shown, foreign, headMoved } = this
    const touched: EventBody[] = paths.length + shown.length > 0 ? [{ kind: 'touch', tool, paths, foreign, unattributed: shown }] : []

    return headMoved === null ? touched : [...touched, { kind: 'head-moved', tool, ...headMoved }]
  }
}
