import { patchedPaths } from '../../lib/text/patch.ts'
import type { Payload } from '../events/payload.ts'
import { EditCall } from '../tool-calls/edit-call.ts'
import { AbstractAgent } from './abstract-agent.ts'

const PATCH_TOOL = 'apply_patch'

export class Codex extends AbstractAgent {
  override readonly name = 'codex'

  protected override editCall(tool: string, input: Payload, cwd: string): EditCall | null {
    return tool === PATCH_TOOL ? new EditCall(tool, patchedPaths(input.command('command'), cwd)) : null
  }
}
