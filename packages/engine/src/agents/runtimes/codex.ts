import { patchedPaths } from '../../lib/text/patch.ts'
import type { Payload } from '../events/payload.ts'
import { EditCall } from '../tool-calls/edit-call.ts'
import { AbstractAgent } from './abstract-agent.ts'

export class Codex extends AbstractAgent {
  override readonly name = 'codex'
  protected override readonly editTools = ['apply_patch']

  protected override editCall(tool: string, input: Payload, cwd: string): EditCall | null {
    return this.editTools.includes(tool) ? new EditCall(tool, patchedPaths(input.command('command'), cwd)) : null
  }
}
