import type { EngineLink } from '../../link/engine-link.ts'
import type { Output } from '../../output/output.ts'
import { Screen } from '../../output/screen.ts'
import { Project } from '../../project/project.ts'
import { RuntimeCatalog } from '../../runtimes/runtime-catalog.ts'
import { GuideSkill } from '../../skills/guide-skill.ts'
import { StatusMod } from '../../skills/status-mod.ts'
import type { Command } from '../line/command.ts'

export class UninstallCommand implements Command {
  readonly name = 'uninstall'
  readonly usage = 'uninstall [claude] [codex]'
  readonly summary = 'Remove the hooks of Weaver from this project'
  readonly ownerOnly = true
  readonly help = {
    group: 'Set up',
    description: 'Unplug Weaver from this project: its hooks, its guide and its mod are removed, everything else is left as it is.',
    words: [['[claude] [codex]', 'The agent runtimes to unplug; both when none is named']],
    examples: ['weaver uninstall', 'weaver uninstall codex'],
  } as const
  private readonly cwd: string
  private readonly screen: Screen
  private readonly link: EngineLink

  constructor(cwd: string, output: Output, link: EngineLink) {
    this.cwd = cwd
    this.screen = new Screen(output)
    this.link = link
  }

  run(args: readonly string[]): number {
    const project = Project.locate(this.cwd)

    for (const runtime of new RuntimeCatalog().settings(project.top, this.link, args)) {
      if (runtime.uninstall()) this.screen.done(`${runtime.label}: hooks removed from ${runtime.file}`)
      else this.screen.note(`${runtime.label}: no hook to remove`)

      if (GuideSkill.remove(project.top, runtime.guide))
        this.screen.done(`${runtime.label}: the guide of Weaver removed from ${runtime.guide}`)
      if (runtime.mod !== null && StatusMod.remove(project.top, runtime.mod))
        this.screen.done(`${runtime.label}: the mod that shows the end of a task removed from ${runtime.mod}`)
    }

    this.screen.line()
    this.screen.hint(`${project.configName}/ and .git/weaver/ are left: they hold your rules and Weaver's records.`)

    return 0
  }
}
