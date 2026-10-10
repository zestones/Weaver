import { RuntimeSettings } from './runtime-settings.ts'

export class ClaudeCodeSettings extends RuntimeSettings {
  override readonly label = 'Claude Code'
  // The settings file Claude Code means for one machine: the wiring holds paths of this one.
  override readonly file = '.claude/settings.local.json'
}
