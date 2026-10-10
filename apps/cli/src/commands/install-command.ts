import { dirname } from 'node:path'
import type { EngineLink } from '../link/engine-link.ts'
import type { Output } from '../output/output.ts'
import { Project } from '../project/project.ts'
import { RuntimeCatalog } from '../runtimes/runtime-catalog.ts'
import type { Command } from './command.ts'

export class InstallCommand implements Command {
  readonly name = 'install'
  readonly usage = 'install [claude] [codex]'
  readonly summary = 'Plug Weaver into this project: the hooks of the agent runtimes, and a starter configuration if there is none.'
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
      project.createConfig(this.link.schema)
        ? `${project.configName} created: declare your rules, checks and guards there.`
        : `${project.configName} kept as it is.`,
    )
    const skill = project.finishSkill()

    if (skill?.create() === true) this.output.say(`${skill.path} created: it tells the agent how to end a task. Adapt it to your project.`)

    this.output.say(
      `Wired to the Weaver checkout that holds ${dirname(this.link.hook)}. This is temporary: run weaver install again if it moves, and weaver doctor to check it.`,
    )

    return 0
  }
}
