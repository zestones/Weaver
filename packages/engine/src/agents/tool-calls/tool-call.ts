import { isAbsolute, relative } from 'node:path'
import type { ShellCommand } from '../../lib/shell/syntax/command.ts'
import type { ScriptHints } from '../../lib/shell/writes/hints.ts'
import type { WriteScope } from '../../lib/shell/writes/write-scope.ts'

export interface CallWrites {
  readonly targets: readonly string[] | null
  readonly scope: WriteScope
}

export interface NamedPaths {
  readonly written: readonly string[]
  // A removed folder takes with it what is under it.
  readonly removed: readonly string[]
}

export abstract class ToolCall {
  readonly name: string
  readonly background: boolean

  constructor(name: string, background: boolean) {
    this.name = name
    this.background = background
  }

  abstract writes(top: string, hints: ScriptHints): CallWrites | null

  abstract named(): NamedPaths

  abstract commands(): readonly ShellCommand[]

  protected inside(top: string, paths: readonly string[]): string[] {
    return paths.map((path) => relative(top, path)).filter((path) => path !== '' && !path.startsWith('..') && !isAbsolute(path))
  }
}
