import { RuntimeSettings } from './runtime-settings.ts'

export class CodexSettings extends RuntimeSettings {
  override readonly label = 'Codex'
  override readonly file = '.codex/hooks.json'
}
