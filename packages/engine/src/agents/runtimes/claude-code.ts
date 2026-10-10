import { isAbsolute, resolve } from 'node:path'
import type { Payload } from '../events/payload.ts'
import { EditCall } from '../tool-calls/edit-call.ts'
import { AbstractAgent } from './abstract-agent.ts'

const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

export class ClaudeCode extends AbstractAgent {
  override readonly name = 'claude'

  protected override editCall(tool: string, input: Payload, cwd: string): EditCall | null {
    if (!EDIT_TOOLS.has(tool)) return null

    const path = input.text('file_path') ?? input.text('notebook_path') ?? ''

    return new EditCall(tool, [isAbsolute(path) ? path : resolve(cwd, path)])
  }
}
