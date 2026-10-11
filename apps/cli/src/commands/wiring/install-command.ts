import { dirname } from 'node:path'
import type { EngineLink } from '../../link/engine-link.ts'
import type { Output } from '../../output/output.ts'
import { Project } from '../../project/project.ts'
import { RuntimeCatalog } from '../../runtimes/runtime-catalog.ts'
import type { Command } from '../line/command.ts'

export class InstallCommand implements Command {
  readonly name = 'install'
  readonly usage = 'install [claude] [codex]'
  readonly summary = 'Plug Weaver into this project: the hooks of the agent runtimes, and a starter configuration if there is none.'
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
    const runtimes = new RuntimeCatalog().settings(project.top, this.link, args)

    if (!this.link.isAlive()) {
      this.output.say(`The hook does not start (${this.link.hook}). Build Weaver first with pnpm build, then run this again.`)

      return 1
    }

    for (const runtime of runtimes) {
      runtime.install()
      this.output.say(`${runtime.label}: hooks written to ${runtime.file}`)

      if (!project.ignores(runtime.file)) {
        this.output.say(`  ${runtime.file} is not ignored by git and names paths of this machine: add it to .gitignore.`)
      }
    }

    this.output.say(
      project.createConfig(this.link)
        ? `${project.configName}/ created: declare your guards and your checks in ${project.configName}/project/.`
        : `${project.configName}/ kept as it is.`,
    )

    for (const skill of project.skills()) {
      if (skill.create()) this.output.say(`${skill.path} created: ${skill.purpose} Adapt it to your project.`)
    }

    this.output.say(
      `Wired to the Weaver checkout that holds ${dirname(this.link.hook)}. This is temporary: run weaver install again if it moves, and weaver doctor to check it.`,
    )

    return 0
  }
}
