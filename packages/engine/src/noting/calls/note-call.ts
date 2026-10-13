import { WeaverCommand } from '../../agents/commands/weaver-command.ts'
import type { ToolCall } from '../../agents/tool-calls/tool-call.ts'

const COMMAND = 'note'

// A note as an agent writes it: a shell call that runs `weaver note`, with what it says in a heredoc or in its words.
export class NoteCall {
  // What follows the command: the number of the card, what the note concludes, and its text when no heredoc gives it.
  readonly words: readonly string[]
  // null when no heredoc follows the command.
  readonly body: string | null

  private constructor(weaver: WeaverCommand) {
    this.words = weaver.words.slice(1)
    this.body = weaver.heredoc
  }

  static in(call: ToolCall): NoteCall | null {
    const weaver = WeaverCommand.among(call.commands()).find(({ words }) => words[0] === COMMAND)

    return weaver === undefined ? null : new NoteCall(weaver)
  }
}
