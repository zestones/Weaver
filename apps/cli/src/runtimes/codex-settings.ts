import { RuntimeSettings } from './runtime-settings.ts'

export class CodexSettings extends RuntimeSettings {
  override readonly label = 'Codex'
  override readonly file = '.codex/hooks.json'
  // The folder of skills Codex documents for a repository, shared by other runtimes.
  override readonly guide = '.agents/skills/weaver/SKILL.md'
  override readonly hidingGuide = null
  override readonly mod = null
}
