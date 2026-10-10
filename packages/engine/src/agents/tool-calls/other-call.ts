import { ToolCall } from './tool-call.ts'

export class OtherCall extends ToolCall {
  constructor(name: string) {
    super(name, false)
  }

  override writes(): null {
    return null
  }
}
