import { tmpdir } from 'node:os'
import { sep } from 'node:path'
import type { ToolCall } from '../../agents/tool-calls/tool-call.ts'
import { realPath } from '../../lib/files/real-path.ts'
import type { Refusal } from '../results/refusal.ts'
import { Guard } from './guard.ts'

// A reviewer that may write is given a copy of the project: what it changes there is thrown away, and it changes
// nothing anywhere else.
export class CopyGuard extends Guard {
  private readonly roots: readonly string[]

  constructor(copy: string) {
    super({
      id: 'weaver:review-copy',
      statement: `A reviewer writes only inside its copy of the project (${copy}) and the temporary folder of the machine.`,
    })
    this.roots = [copy, tmpdir()].map(realPath)
  }

  override refusal(call: ToolCall): Refusal | null {
    const { written, removed } = call.named()
    const hit = [...written, ...removed]
      .map(realPath)
      .find((path) => !this.roots.some((root) => path === root || path.startsWith(`${root}${sep}`)))

    return hit === undefined ? null : this.refuse(`Writing ${hit}`)
  }
}
