import type { EngineLink } from '../../link/engine-link.ts'
import type { Output } from '../../output/output.ts'
import { Project } from '../../project/project.ts'
import { RuntimeCatalog } from '../../runtimes/runtime-catalog.ts'
import type { Command } from '../line/command.ts'

export class UninstallCommand implements Command {
  readonly name = 'uninstall'
  readonly usage = 'uninstall [claude] [codex]'
  readonly summary = 'Unplug Weaver from this project: its hooks are removed, everything else is left as it is.'
  readonly ownerOnly = true
  private readonly cwd: string
  private readonly output: Output
  private readonly link: EngineLink

  constructor(cwd: string, output: Output, link: EngineLink) {
    this.cwd = cwd
    this.output = output
    this.link = link
  }

  run(args: readonly string[]): number {
    const project = Project.locate(this.cwd)

    for (const runtime of new RuntimeCatalog().settings(project.top, this.link, args)) {
      this.output.say(runtime.uninstall() ? `${runtime.label}: hooks removed from ${runtime.file}` : `${runtime.label}: no hook to remove`)
    }

    this.output.say(`${project.configName}/ and .git/weaver/ are left: they hold your rules and Weaver's records.`)

    return 0
  }
}
