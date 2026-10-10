import type { ToolCall } from '../../agents/tool-calls/tool-call.ts'
import { runsAs } from '../../lib/shell/writes/hints.ts'
import type { Refusal } from '../results/refusal.ts'
import { Guard, type GuardFields } from './guard.ts'

export class RunsGuard extends Guard {
  private readonly entries: readonly string[]

  constructor(fields: GuardFields, entries: readonly string[]) {
    super(fields)
    this.entries = entries
  }

  override refusal(call: ToolCall): Refusal | null {
    const commands = call.commands()
    const entry = this.entries.find((candidate) => commands.some((command) => runsAs(command, candidate)))

    return entry === undefined ? null : this.refuse(`Running \`${entry}\``)
  }
}
