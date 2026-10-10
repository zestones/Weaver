import type { Blob } from '../../lib/git/repository.ts'
import type { WriteScope } from '../../lib/shell/writes/write-scope.ts'

export interface WindowRecord {
  readonly at: string
  readonly tool: string
  readonly untilStop: boolean
  // The window watches the paths it names and no other.
  readonly exact: boolean
  readonly before: Readonly<Record<string, Blob>>
  readonly head: string | null
  readonly attribution: WriteScope
}
