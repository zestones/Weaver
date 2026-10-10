import { isAbsolute, relative } from 'node:path'
import type { ToolCall } from '../../agents/tool-calls/tool-call.ts'
import { realPath } from '../../lib/files/real-path.ts'
import { globRoot, matchesAny } from '../../lib/text/glob.ts'
import type { Refusal } from '../results/refusal.ts'
import { Guard, type GuardFields } from './guard.ts'

export class WritesGuard extends Guard {
  private readonly top: string
  private readonly globs: readonly string[]

  constructor(fields: GuardFields, top: string, globs: readonly string[]) {
    super(fields)
    this.top = realPath(top)
    this.globs = globs
  }

  override refusal(call: ToolCall): Refusal | null {
    const { written, removed } = call.named()
    const hit =
      this.inRepository(written).find((path) => matchesAny(this.globs, path)) ??
      this.inRepository(removed).find((folder) => this.holds(folder))

    return hit === undefined ? null : this.refuse(`Writing ${hit === '' ? 'the repository root' : hit}`)
  }

  private inRepository(paths: readonly string[]): string[] {
    return paths.map((path) => relative(this.top, realPath(path))).filter((path) => !path.startsWith('..') && !isAbsolute(path))
  }

  private holds(folder: string): boolean {
    return this.globs.map(globRoot).some((root) => folder === '' || root === folder || root.startsWith(`${folder}/`))
  }
}
