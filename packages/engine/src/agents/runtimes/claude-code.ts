import { isAbsolute, resolve } from 'node:path'
import type { Payload } from '../events/payload.ts'
import { EditCall } from '../tool-calls/edit-call.ts'
import { AbstractAgent } from './abstract-agent.ts'

export class ClaudeCode extends AbstractAgent {
  override readonly name = 'claude'
  // A command that exits with an error fires PostToolUseFailure in place of PostToolUse.
  override readonly events = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop']
  protected override readonly editTools = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']
  protected override readonly taskTools = ['Agent']

  protected override editCall(tool: string, input: Payload, cwd: string): EditCall | null {
    if (!this.editTools.includes(tool)) return null

    const path = input.text('file_path') ?? input.text('notebook_path') ?? ''

    return new EditCall(tool, [isAbsolute(path) ? path : resolve(cwd, path)])
  }
}
