import { ToolCall, type NamedPaths } from './tool-call.ts'

export class OtherCall extends ToolCall {
  constructor(name: string) {
    super(name, false)
  }

  override writes(): null {
    return null
  }

  override named(): NamedPaths {
    return { written: [], removed: [] }
  }

  override commands(): [] {
    return []
  }
}
