import { WeaverCommand } from '../../agents/commands/weaver-command.ts'
import type { ToolCall } from '../../agents/tool-calls/tool-call.ts'

const COMMAND = 'flag'
const TABS_STRIPPED = '<<-'

// A flag as an agent makes it: a shell call that runs `weaver flag`, with its five fields in a heredoc.
export class FlagCall {
  // As written, relative to where the command runs.
  readonly places: readonly string[]
  // null when no heredoc follows the command.
  readonly body: string | null
  // Followed through the `cd`s before the command; null once the directory is unknown.
  readonly cwd: string | null

  private constructor(weaver: WeaverCommand) {
    const { redirects, cwd } = weaver.command
    const heredoc = redirects.find((redirect) => redirect.heredoc !== null)
    const text = heredoc?.heredoc ?? null

    this.places = weaver.words.slice(1).filter((word) => !word.startsWith('-'))
    // The shell takes the leading tabs off a heredoc opened with `<<-`; the parser leaves them.
    this.body = text !== null && heredoc?.operator === TABS_STRIPPED ? text.replace(/^\t+/gm, '') : text
    this.cwd = cwd
  }

  static in(call: ToolCall): FlagCall | null {
    const weaver = WeaverCommand.among(call.commands()).find(({ words }) => words[0] === COMMAND)

    return weaver === undefined ? null : new FlagCall(weaver)
  }
}
