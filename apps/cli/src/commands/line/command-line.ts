import { ExecutionCatalog } from '@weaver/agent-sdk'
import type { Caller } from '../../caller/caller.ts'
import { ProcessCaller } from '../../caller/process-caller.ts'
import type { Input } from '../../input/input.ts'
import { StandardInput } from '../../input/standard-input.ts'
import { EngineLink } from '../../link/engine-link.ts'
import type { Output } from '../../output/output.ts'
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
import { DoctorCommand } from '../wiring/doctor-command.ts'
import { InstallCommand } from '../wiring/install-command.ts'
import { UninstallCommand } from '../wiring/uninstall-command.ts'
import { VersionCommand } from '../wiring/version-command.ts'
import type { Command } from './command.ts'

const HELP = new Set(['help', '--help', '-h'])
const ALIASES: Readonly<Record<string, string>> = { '--version': 'version', '-v': 'version' }

export class CommandLine {
  private readonly cwd: string
  private readonly output: Output
  private readonly link: EngineLink | null
  private readonly executions: ExecutionCatalog
  private readonly caller: Caller
  private readonly input: Input

  constructor(
    cwd: string,
    output: Output,
    link: EngineLink | null = null,
    executions: ExecutionCatalog = new ExecutionCatalog(),
    caller: Caller = new ProcessCaller(),
    input: Input = new StandardInput(),
  ) {
    this.cwd = cwd
    this.output = output
    this.link = link
    this.executions = executions
    this.caller = caller
    this.input = input
  }

  async run(argv: readonly string[]): Promise<number> {
    const [name] = argv

    try {
      const commands = this.commands()
      const command = this.called(commands, argv)

      if (command === undefined) {
        this.usage(commands)

        return name === undefined || HELP.has(name) ? 0 : 2
      }

      const agent = command.ownerOnly ? this.caller.agent() : null

      if (agent === null) return await command.run(argv.slice(command.name.split(' ').length))

      this.output.say(
        `weaver ${command.name} is the owner's: it decides or changes something, so it runs from a terminal of their own, and not under ${agent}.`,
      )

      return 1
    } catch (error) {
      this.output.say(`weaver: ${error instanceof Error ? error.message : String(error)}`)

      return 1
    }
  }

  private commands(): Command[] {
    const link = this.link ?? new EngineLink()

    return [
      new InstallCommand(this.cwd, this.output, link),
      new UninstallCommand(this.cwd, this.output, link),
      new DoctorCommand(this.cwd, this.output, link, this.executions),
      new VersionCommand(this.output),
      new FlagCommand(this.cwd, this.output, this.input, this.caller),
      new CardsCommand(this.cwd, this.output),
      new ReopenCommand(this.cwd, this.output),
      new RetitleCommand(this.cwd, this.output),
      new LabelCommand(this.cwd, this.output),
      new RewriteCommand(this.cwd, this.output, this.input),
      new TieCommand(this.cwd, this.output),
      new UntieCommand(this.cwd, this.output),
      new SeparateCommand(this.cwd, this.output),
      new CloseCommand(this.cwd, this.output),
    ]
  }

  // A name of two words wins over its first word: `cards reopen` is not `cards` given the word `reopen`.
  private called(commands: readonly Command[], argv: readonly string[]): Command | undefined {
    const [first = ''] = argv
    const words = argv.slice(0, 2).join(' ')

    return commands.find((command) => command.name === words) ?? commands.find((command) => command.name === (ALIASES[first] ?? first))
  }

  private usage(commands: readonly Command[]): void {
    const width = Math.max(...commands.map((command) => command.usage.length))

    this.output.say('weaver <command>')
    this.output.say('')
    for (const command of commands) this.output.say(`  ${command.usage.padEnd(width)}  ${command.summary}`)
  }
}
