import { dirname } from 'node:path'
import type { EngineLink } from '../../link/engine-link.ts'
import { OwnRelease } from '../../link/own-release.ts'
import type { Output } from '../../output/output.ts'
import { Screen } from '../../output/screen.ts'
import { Project } from '../../project/project.ts'
import { RuntimeCatalog } from '../../runtimes/runtime-catalog.ts'
import type { RuntimeSettings } from '../../runtimes/runtime-settings.ts'
import type { Command } from '../line/command.ts'

export class InstallCommand implements Command {
  readonly name = 'install'
  readonly usage = 'install [claude] [codex]'
  readonly summary = 'Put Weaver on this project'
  readonly ownerOnly = true
  readonly help = {
    group: 'Set up',
    description:
      'Put Weaver on this project: the hooks of the agent runtimes, the guide they read as a skill, and a starter configuration if there is none.',
    words: [['[claude] [codex]', 'The agent runtimes to wire; both when none is named']],
    examples: ['weaver install', 'weaver install claude'],
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
    const runtimes = new RuntimeCatalog().settings(project.top, this.link, args)

    if (!this.link.isAlive()) {
      this.screen.error(`The hook does not start (${this.link.hook}).`, 'Build Weaver first with pnpm build, then run this again.')

      return 1
    }

    const migrations = project.migrations()

    if (migrations.isBehind || migrations.isAhead) {
      const which = migrations.isBehind ? 'an earlier format than this Weaver reads' : 'a later format than this Weaver reads'

      this.screen.error(
        `${project.configName}/ is in ${which}.`,
        'Run weaver update, which brings this project and Weaver to the same one.',
      )

      return 1
    }

    for (const runtime of runtimes) {
      runtime.install()
      this.screen.done(`${runtime.label}: hooks written to ${runtime.file}`)

      const shared = this.shared(project, runtime.file)

      if (shared !== null) this.screen.alert(shared, 1)
    }

    if (project.createConfig(this.link)) {
      this.screen.done(`${project.configName}/ created: declare your guards and your checks in ${project.configName}/project/.`)
    } else {
      this.screen.note(`${project.configName}/ kept as it is.`)
    }

    for (const skill of project.skills()) {
      if (skill.create()) this.screen.done(`${skill.path} created: ${skill.purpose} Adapt it to your project.`)
    }

    // The guide is written from the configuration, which a first install has just created.
    for (const runtime of runtimes) this.guide(project, runtime)

    this.screen.line()
    this.screen.hint(this.wired())

    return 0
  }

  private guide(project: Project, runtime: RuntimeSettings): void {
    const guide = project.guide(runtime.guide)

    if (guide === null) return

    guide.write()
    this.screen.done(`${runtime.label}: the guide of Weaver written to ${guide.path}`)

    if (!project.ignores(guide.path)) {
      this.screen.alert(`${guide.path} is not ignored by git, and Weaver writes it again with each update: add it to .gitignore.`, 1)
    }
  }

  // The hooks name paths of this machine: the file that holds them is not to be shared. null when git neither
  // follows it nor would. A file committed before it was ignored is still followed, whatever the ignore files say.
  private shared(project: Project, file: string): string | null {
    const ignored = project.ignores(file)
    const kept = `\`git rm --cached ${file}\`, which keeps the file`

    if (!project.tracks(file))
      return ignored ? null : `${file} is not ignored by git and names paths of this machine: add it to .gitignore.`

    return ignored
      ? `${file} is ignored by git, which still follows it because it was committed before: it names paths of this machine. Stop that with ${kept}.`
      : `${file} is followed by git and names paths of this machine: add it to .gitignore, then run ${kept}.`
  }

  // A release keeps its folder; a checkout may move, and its build may go.
  private wired(): string {
    const own = new OwnRelease()

    return own.isCheckout
      ? `Wired to the Weaver checkout that holds ${dirname(this.link.hook)}: run weaver install again if it moves, and weaver doctor to check it.`
      : `Wired to Weaver ${own.tag}. weaver update keeps this project up to date, and weaver doctor checks it.`
  }
}
