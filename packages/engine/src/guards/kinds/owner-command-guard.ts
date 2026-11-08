import { WeaverCommand } from '../../agents/commands/weaver-command.ts'
import type { ToolCall } from '../../agents/tool-calls/tool-call.ts'
import type { Refusal } from '../results/refusal.ts'
import { Guard } from './guard.ts'

const OWNED: readonly string[] = ['close', 'install', 'uninstall', 'update', 'maintenance']
// An agent reads the cards and flags what it finds. An agent that could close a card could empty the pile it fills,
// and one that could unplug Weaver or lift its guards would no longer be held by them.
export class OwnerCommandGuard extends Guard {
  // The commands it refuses, as they are typed after `weaver`.
  static readonly COMMANDS: readonly string[] = OWNED

  constructor() {
    super({
      id: 'weaver:owner-command',
      statement:
        "Closing a card, plugging Weaver in or out and lifting its guards are the owner's, from a terminal of their own. Say in your final message what you need them to run.",
      liftable: false,
    })
  }

  override refusal(call: ToolCall): Refusal | null {
    // Asking how a command is used decides nothing.
    const asked = WeaverCommand.among(call.commands()).filter((weaver) => !weaver.asksHelp)
    const owned = asked.flatMap((weaver) => this.owned(weaver.words))[0]

    return owned === undefined ? null : this.refuse(`Running \`weaver ${owned}\``)
  }

  private owned(words: readonly string[]): string[] {
    const [command = ''] = words.filter((word) => !word.startsWith('-'))
    const typed = command

    return OwnerCommandGuard.COMMANDS.includes(typed) ? [typed] : []
  }
}
