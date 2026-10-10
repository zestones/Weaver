import type { ShellCommand } from '../../lib/shell/syntax/command.ts'
import { analyzeShell } from '../../lib/shell/syntax/parse.ts'
import type { CommandHints } from '../../lib/shell/writes/hints.ts'
import { shellWrites } from '../../lib/shell/writes/write-scope.ts'
import { writtenPaths } from '../../lib/shell/writes/written-paths.ts'
import { PATCH_BEGIN, patchedPaths } from '../../lib/text/patch.ts'
import { ToolCall, type CallWrites, type NamedPaths } from './tool-call.ts'

export class ShellCall extends ToolCall {
  private readonly command: string
  private readonly cwd: string

  constructor(name: string, command: string, cwd: string, background: boolean) {
    super(name, background)
    this.command = command
    this.cwd = cwd
  }

  override writes(top: string, hints: CommandHints): CallWrites | null {
    const patched = this.patched()

    if (patched.length > 0) return { targets: this.inside(top, patched), scope: 'all' }

    const scope = shellWrites(this.command, this.cwd, top, hints)

    return scope === null ? null : { targets: null, scope }
  }

  override named(): NamedPaths {
    const patched = this.patched()

    if (patched.length > 0) return { written: patched, removed: [] }

    const writes = this.commands().map((command) => writtenPaths(command, this.cwd))

    return { written: writes.flatMap((each) => each.paths), removed: writes.flatMap((each) => each.removed) }
  }

  override commands(): readonly ShellCommand[] {
    return analyzeShell(this.command, this.cwd).commands
  }

  // A command that carries a patch writes the files the patch names.
  private patched(): string[] {
    return this.command.includes(PATCH_BEGIN) ? patchedPaths(this.command, this.cwd) : []
  }
}
