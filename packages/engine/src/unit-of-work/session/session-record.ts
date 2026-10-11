import type { WindowRecord } from '../attribution/window-record.ts'
import type { UnitRecord } from '../unit/unit-record.ts'

export interface SessionRecord {
  readonly version: 4
  readonly agent: string
  readonly unit: UnitRecord
  readonly pending: Readonly<Record<string, WindowRecord>>
  readonly lastReply: string | null
  // The content of the last review that gave no findings, which the owner may have tried again.
  readonly failedReview: string | null
  // HEAD at the last look, to tell which paths the owner's next git actions moved.
  readonly head: string | null
}
