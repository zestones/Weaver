import { WeaverCommand } from '../../agents/commands/weaver-command.ts'
import type { ToolCall } from '../../agents/tool-calls/tool-call.ts'

const COMMAND = 'cards'
const NUMBER = /^\d+$/

// A card an agent reads, with `weaver cards <number>`: the task it reads it in may settle it.
export class CardReading {
  readonly card: number

  private constructor(card: number) {
    this.card = card
  }

  static among(call: ToolCall): CardReading[] {
    return WeaverCommand.among(call.commands()).flatMap(({ words }) => {
      const [command, number = ''] = words

      return command === COMMAND && NUMBER.test(number) ? [new CardReading(Number(number))] : []
    })
  }
}
