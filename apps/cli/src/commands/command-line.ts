import { EngineLink } from '../link/engine-link.ts'
import type { Output } from '../output/output.ts'
import type { Command } from './command.ts'
import { DoctorCommand } from './doctor-command.ts'
import { InstallCommand } from './install-command.ts'
import { UninstallCommand } from './uninstall-command.ts'

const HELP = new Set(['help', '--help', '-h'])

export class CommandLine {
  private readonly cwd: string
  private readonly output: Output
  private readonly link: EngineLink | null

  constructor(cwd: string, output: Output, link: EngineLink | null = null) {
    this.cwd = cwd
    this.output = output
    this.link = link
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

    return [InstallCommand, UninstallCommand, DoctorCommand].map((Each) => new Each(this.cwd, this.output, link))
  }

  private usage(commands: readonly Command[]): void {
    const width = Math.max(...commands.map((command) => command.usage.length))

    this.output.say('weaver <command>')
    this.output.say('')
    for (const command of commands) this.output.say(`  ${command.usage.padEnd(width)}  ${command.summary}`)
  }
}
