import { homedir } from 'node:os'
import { join } from 'node:path'
import { RuntimeSettings } from './runtime-settings.ts'

export class ClaudeCodeSettings extends RuntimeSettings {
  override readonly label = 'Claude Code'
  // The settings file Claude Code means for one machine: the wiring holds paths of this one.
  override readonly file = '.claude/settings.local.json'
  override readonly guide = '.claude/skills/weaver/SKILL.md'
  // Claude Code prefers a personal skill to one of the project that has its name.
  override readonly hidingGuide = join(homedir(), '.claude/skills/weaver/SKILL.md')
}
