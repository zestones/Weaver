import { isAbsolute, relative } from 'node:path'
import type { CommandHints } from '../../lib/shell/writes/hints.ts'
import type { WriteScope } from '../../lib/shell/writes/write-scope.ts'

export interface CallWrites {
  readonly targets: readonly string[] | null
  readonly scope: WriteScope
}

export abstract class ToolCall {
  readonly name: string
  readonly background: boolean

  constructor(name: string, background: boolean) {
    this.name = name
    this.background = background
  }

  abstract writes(top: string, hints: CommandHints): CallWrites | null

  protected inside(top: string, paths: readonly string[]): string[] {
    return paths.map((path) => relative(top, path)).filter((path) => path !== '' && !path.startsWith('..') && !isAbsolute(path))
  }
}
