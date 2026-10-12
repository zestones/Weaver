import { relative, sep } from 'node:path'
import type { ToolCall } from '../../agents/tool-calls/tool-call.ts'
import { realPath } from '../../lib/files/real-path.ts'
import type { Refusal } from '../results/refusal.ts'
import { Guard, type GuardFields } from './guard.ts'

// Refuses a call that names a write under one of the paths it owns, or that removes a folder holding one.
export abstract class PathsGuard extends Guard {
  private readonly top: string
  private readonly owned: readonly string[]

  constructor(fields: GuardFields, top: string, owned: readonly string[]) {
    super(fields)
    this.top = realPath(top)
    this.owned = owned.map(realPath)
  }

  override refusal(call: ToolCall): Refusal | null {
    const { written, removed } = call.named()
    const hit = written.map(realPath).find((path) => this.owns(path)) ?? removed.map(realPath).find((folder) => this.holds(folder))

    if (hit === undefined) return null

    const inside = relative(this.top, hit)

    return this.refuse(`Writing ${inside === '' || inside.startsWith('..') ? hit : inside}`)
  }

  private owns(path: string): boolean {
    return this.owned.some((own) => path === own || path.startsWith(`${own}${sep}`))
  }

  private holds(folder: string): boolean {
    return this.owned.some((own) => own.startsWith(`${folder}${sep}`))
  }
}
