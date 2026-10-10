import { ToolCall, type CallWrites } from './tool-call.ts'

export class EditCall extends ToolCall {
  private readonly paths: readonly string[]

  constructor(name: string, paths: readonly string[]) {
    super(name, false)
    this.paths = paths
  }

  override writes(top: string): CallWrites {
    return { targets: this.inside(top, this.paths), scope: 'all' }
  }
}
