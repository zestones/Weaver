import type { WindowRecord } from '../attribution/window-record.ts'
import type { UnitRecord } from '../unit/unit-record.ts'

export interface SessionRecord {
  readonly version: 9
  readonly agent: string
  readonly unit: UnitRecord
  readonly pending: Readonly<Record<string, WindowRecord>>
  readonly lastReply: string | null
  // The content of the last review that gave no findings, which the owner may have tried again.
  readonly failedReview: string | null
  // HEAD at the last look, to tell which paths the owner's next git actions moved.
  readonly head: string | null
  // The cards flagged since the last end of turn, which names them to the owner.
  readonly flagged: readonly number[]
  // Since when the owner lifts the guards of the project for this session; null outside maintenance.
  readonly maintenance: string | null
  // The last `weaver check` its agent ran, as the hook saw it go by: the command reads it to know whose work it checks.
  readonly asked: AskedCheck | null
  // The tasks its agent left running, by their id, each with when it is given up on if its end is never told.
  readonly background: Readonly<Record<string, string>>
}

interface AskedCheck {
  readonly at: string
  // The names the command was given, in order.
  readonly names: readonly string[]
}
