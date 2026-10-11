import { WeaverCommand } from '../../agents/commands/weaver-command.ts'
import type { ToolCall } from '../../agents/tool-calls/tool-call.ts'
import type { Refusal } from '../results/refusal.ts'
import { Guard } from './guard.ts'

const OWNED: ReadonlySet<string> = new Set(['close', 'install', 'uninstall'])
const CARDS = 'cards'
// What `weaver cards` does beyond listing and printing.
const CHANGES: ReadonlySet<string> = new Set(['reopen', 'retitle', 'label', 'rewrite', 'tie', 'untie', 'separate'])

// An agent reads the cards and flags what it finds. An agent that could close a card could empty the pile it fills,
// and one that could unplug Weaver would no longer be checked.
export class OwnerCommandGuard extends Guard {
  constructor() {
    super({
      id: 'weaver:owner-command',
      statement: "Deciding on a card and plugging Weaver in or out are the owner's, from a terminal of their own.",
    })
  }

  override refusal(call: ToolCall): Refusal | null {
    const owned = WeaverCommand.among(call.commands()).flatMap((weaver) => this.owned(weaver.words))[0]

    return owned === undefined ? null : this.refuse(`Running \`weaver ${owned}\``)
  }

  private owned(words: readonly string[]): string[] {
    const [command = '', action = ''] = words.filter((word) => !word.startsWith('-'))

    if (OWNED.has(command)) return [command]

    return command === CARDS && CHANGES.has(action) ? [`${command} ${action}`] : []
  }
}
