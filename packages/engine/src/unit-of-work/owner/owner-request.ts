import type { Intent } from '../unit/unit-record.ts'

const TEXT_LIMIT = 4000
const REPLY_LIMIT = 2000
// What an agent runtime injects through its prompt event is not the owner speaking.
const SYSTEM_PREFIXES = [
  '<agent-message',
  '<task-notification',
  '<system-reminder',
  '<user_shell_command>',
  '<codex_internal_context',
  'Another Claude session sent a message',
]

export class OwnerRequest {
  private readonly text: string

  constructor(text: string) {
    this.text = text
  }

  get isFromOwner(): boolean {
    const start = this.text.trimStart()

    return start !== '' && !SYSTEM_PREFIXES.some((prefix) => start.startsWith(prefix))
  }

  // The request as it is kept: a pasted log is cut, and says by how much.
  get kept(): string {
    return this.clip(this.text, TEXT_LIMIT)
  }

  intent(answering: string | null): Intent {
    return {
      at: new Date().toISOString(),
      source: 'prompt',
      text: this.kept,
      answering: answering === null ? null : this.clip(answering, REPLY_LIMIT),
    }
  }

  private clip(text: string, limit: number): string {
    const trimmed = text.trim()

    return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)} [cut ${String(trimmed.length - limit)} chars]`
  }
}
