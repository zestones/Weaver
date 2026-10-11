import { ExecutionCatalog } from '@weaver/agent-sdk'
import { EngineLink } from '../link/engine-link.ts'
import type { Output } from '../output/output.ts'
import { CloseCommand } from './close-command.ts'
import type { Command } from './command.ts'
import { DoctorCommand } from './doctor-command.ts'
import { InstallCommand } from './install-command.ts'
import { StatusCommand } from './status-command.ts'
import { UninstallCommand } from './uninstall-command.ts'

const HELP = new Set(['help', '--help', '-h'])

export class CommandLine {
  private readonly cwd: string
  private readonly output: Output
  private readonly link: EngineLink | null
  private readonly executions: ExecutionCatalog

  constructor(cwd: string, output: Output, link: EngineLink | null = null, executions: ExecutionCatalog = new ExecutionCatalog()) {
    this.cwd = cwd
    this.output = output
    this.link = link
    this.executions = executions
  }

  run(argv: readonly string[]): number {
    const [name, ...args] = argv

    try {
      const commands = this.commands()
      const command = commands.find((known) => known.name === name)

      if (command !== undefined) return command.run(args)

      this.usage(commands)

      return name === undefined || HELP.has(name) ? 0 : 2
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
      new StatusCommand(this.cwd, this.output),
      new CloseCommand(this.cwd, this.output),
    ]
  }

  private usage(commands: readonly Command[]): void {
    const width = Math.max(...commands.map((command) => command.usage.length))

    this.output.say('weaver <command>')
    this.output.say('')
    for (const command of commands) this.output.say(`  ${command.usage.padEnd(width)}  ${command.summary}`)
  }
}
