import { ExecutionCatalog } from '@weaver/agent-sdk'
import type { Caller } from '../../caller/caller.ts'
import { ProcessCaller } from '../../caller/process-caller.ts'
import type { Input } from '../../input/input.ts'
import { StandardInput } from '../../input/standard-input.ts'
import { EngineLink } from '../../link/engine-link.ts'
import type { Output } from '../../output/output.ts'
import { Screen } from '../../output/screen.ts'
import { ReleaseChannel } from '../../releases/release-channel.ts'
import { CloseCommand } from '../changes/close-command.ts'
import { LabelCommand } from '../changes/label-command.ts'
import { ReopenCommand } from '../changes/reopen-command.ts'
import { RetitleCommand } from '../changes/retitle-command.ts'
import { RewriteCommand } from '../changes/rewrite-command.ts'
import { SeparateCommand } from '../changes/separate-command.ts'
import { TieCommand } from '../changes/tie-command.ts'
import { UntieCommand } from '../changes/untie-command.ts'
import { CardsCommand } from '../memory/cards-command.ts'
import { FlagCommand } from '../memory/flag-command.ts'
import { NoteCommand } from '../memory/note-command.ts'
import { StatsCommand } from '../numbers/stats-command.ts'
import { MaintenanceCommand } from '../sessions/maintenance-command.ts'
import { UiCommand } from '../ui/ui-command.ts'
import { DoctorCommand } from '../wiring/doctor-command.ts'
import { InstallCommand } from '../wiring/install-command.ts'
import { UninstallCommand } from '../wiring/uninstall-command.ts'
import { UpdateCommand } from '../wiring/update-command.ts'
import { VersionCommand } from '../wiring/version-command.ts'
import type { Command } from './command.ts'
import { HelpPage } from './help-page.ts'
import { NearestCommand } from './nearest-command.ts'

const HELP = 'help'
const HELP_FLAGS: ReadonlySet<string> = new Set(['--help', '-h'])
const ALIASES: Readonly<Record<string, string>> = { '--version': 'version', '-v': 'version' }

export class CommandLine {
  // Asks for no colour. It is read where the output is made, and is no word of any command.
  static readonly NO_COLOR = '--no-color'

  private readonly cwd: string
  private readonly output: Output
  private readonly screen: Screen
  private readonly link: EngineLink | null
  private readonly executions: ExecutionCatalog
  private readonly caller: Caller
  private readonly input: Input
  private readonly channel: ReleaseChannel | null

  constructor(
    cwd: string,
    output: Output,
    link: EngineLink | null = null,
    executions: ExecutionCatalog = new ExecutionCatalog(),
    caller: Caller = new ProcessCaller(),
    input: Input = new StandardInput(),
    channel: ReleaseChannel | null = null,
  ) {
    this.cwd = cwd
    this.output = output
    this.screen = new Screen(output)
    this.link = link
    this.executions = executions
    this.caller = caller
    this.input = input
    this.channel = channel
  }

  async run(argv: readonly string[]): Promise<number> {
    // Help is asked for anywhere on the line, whatever else is there.
    const words = argv.filter((word) => word !== CommandLine.NO_COLOR && !HELP_FLAGS.has(word))
    const wantsHelp = words.length < argv.filter((word) => word !== CommandLine.NO_COLOR).length || words[0] === HELP

    try {
      const commands = this.commands()
      const named = words[0] === HELP ? words.slice(1) : words
      const command = this.called(commands, named)
      const help = new HelpPage(commands, this.screen)

      if (named.length === 0) return this.shown(() => help.whole())
      if (command === undefined) return this.unknown(named[0] ?? '', commands)
      if (wantsHelp) return this.shown(() => help.of(command))

      const agent = command.ownerOnly ? this.caller.agent() : null

      if (agent === null) return await command.run(named.slice(command.name.split(' ').length))

      this.screen.error(
        `weaver ${command.name} is the owner's: it decides or changes something, so it runs from a terminal of their own, and not under ${agent}.`,
      )

      return 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      // What a command could not do is said as a sentence, whoever raised it.
      this.screen.error(`${message.charAt(0).toUpperCase()}${message.slice(1)}`)

      return 1
    }
  }

  private shown(page: () => void): number {
    page()

    return 0
  }

  private unknown(word: string, commands: readonly Command[]): number {
    const nearest = new NearestCommand(
      word,
      commands.map((command) => command.name),
    ).name

    this.screen.error(
      `weaver has no command named "${word}".`,
      ...(nearest === null ? [] : [`Did you mean weaver ${nearest}?`]),
      'Run weaver help for the commands it has.',
    )

    return 2
  }

  private commands(): Command[] {
    const link = this.link ?? new EngineLink()

    return [
      new InstallCommand(this.cwd, this.output, link),
      new UpdateCommand(this.cwd, this.output, link, this.channel ?? new ReleaseChannel()),
      new UninstallCommand(this.cwd, this.output, link),
      new DoctorCommand(this.cwd, this.output, link, this.executions),
      new VersionCommand(this.output),
      new MaintenanceCommand(this.cwd, this.output),
      new StatsCommand(this.cwd, this.output),
      new CardsCommand(this.cwd, this.output, this.caller),
      new UiCommand(this.cwd, this.output),
      new FlagCommand(this.cwd, this.output, this.input, this.caller),
      new NoteCommand(this.cwd, this.output, this.input, this.caller),
      new CloseCommand(this.cwd, this.output),
      new ReopenCommand(this.cwd, this.output),
      new RetitleCommand(this.cwd, this.output),
      new LabelCommand(this.cwd, this.output),
      new RewriteCommand(this.cwd, this.output, this.input),
      new TieCommand(this.cwd, this.output),
      new UntieCommand(this.cwd, this.output),
      new SeparateCommand(this.cwd, this.output),
    ]
  }

  // A name of two words wins over its first word: `cards reopen` is not `cards` given the word `reopen`.
  private called(commands: readonly Command[], argv: readonly string[]): Command | undefined {
    const [first = ''] = argv
    const words = argv.slice(0, 2).join(' ')

    return commands.find((command) => command.name === words) ?? commands.find((command) => command.name === (ALIASES[first] ?? first))
  }
}
