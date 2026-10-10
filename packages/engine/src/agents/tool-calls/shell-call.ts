import type { CommandHints } from '../../lib/shell/writes/hints.ts'
import { shellWrites } from '../../lib/shell/writes/write-scope.ts'
import { PATCH_BEGIN, patchedPaths } from '../../lib/text/patch.ts'
import { ToolCall, type CallWrites } from './tool-call.ts'

export class ShellCall extends ToolCall {
  private readonly command: string
  private readonly cwd: string

  constructor(name: string, command: string, cwd: string, background: boolean) {
    super(name, background)
    this.command = command
    this.cwd = cwd
  }

  // A command that carries a patch writes the files the patch names.
  override writes(top: string, hints: CommandHints): CallWrites | null {
    const patched = this.command.includes(PATCH_BEGIN) ? patchedPaths(this.command, this.cwd) : []

    if (patched.length > 0) return { targets: this.inside(top, patched), scope: 'all' }

    const scope = shellWrites(this.command, this.cwd, top, hints)

    return scope === null ? null : { targets: null, scope }
  }
}
