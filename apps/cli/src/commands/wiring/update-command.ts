import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DeclarationFolder, Repository } from '@weaver/engine'
import type { EngineLink } from '../../link/engine-link.ts'
import type { Output } from '../../output/output.ts'
import { Project } from '../../project/project.ts'
import type { ReleaseChannel } from '../../releases/release-channel.ts'
import type { PublishedRelease } from '../../releases/release-source.ts'
import { RuntimeCatalog } from '../../runtimes/runtime-catalog.ts'
import type { Command } from '../line/command.ts'

const DRY_RUN = '--dry-run'
const OFFLINE = '--offline'
// What a release carries besides its archive, which is named after its tag.
const SUMS = 'SHA256SUMS'
const INSTALLER = 'install.sh'

// Being up to date is one thing to ask for and three to do, in this order: Weaver itself, then the configuration of
// the project, then its hooks.
export class UpdateCommand implements Command {
  readonly name = 'update'
  readonly usage = `update [${DRY_RUN}] [${OFFLINE}]`
  readonly summary = 'Bring Weaver and this project up to date: the latest release, the migrations of the configuration, the hooks.'
  readonly ownerOnly = true
  private readonly cwd: string
  private readonly output: Output
  private readonly link: EngineLink
  private readonly channel: ReleaseChannel

  constructor(cwd: string, output: Output, link: EngineLink, channel: ReleaseChannel) {
    this.cwd = cwd
    this.output = output
    this.link = link
    this.channel = channel
  }

  async run(args: readonly string[]): Promise<number> {
    const unknown = args.find((arg) => arg !== DRY_RUN && arg !== OFFLINE)

    if (unknown !== undefined) {
      this.output.say(
        `weaver update does not know ${unknown}: it takes ${DRY_RUN}, which writes nothing, and ${OFFLINE}, which looks for no release.`,
      )

      return 2
    }

    const dryRun = args.includes(DRY_RUN)
    const later = args.includes(OFFLINE) ? null : await this.laterRelease()

    if (later === null) return this.bringProject(dryRun)

    return dryRun ? this.announce(later) : this.handOver(later)
  }

  // The release to move to; null when this one is to be kept, and why is said.
  private async laterRelease(): Promise<PublishedRelease | null> {
    const { own, source } = this.channel

    if (own.isCheckout) {
      this.output.say('Weaver runs from a checkout, which git updates: no release is looked for.')

      return null
    }

    try {
      const latest = await source.latest()

      if (own.isOlderThan(latest.tag)) return latest

      this.output.say(`Weaver ${own.tag} is the latest release.`)
    } catch (error) {
      this.output.say(`No release was looked for: ${error instanceof Error ? error.message : String(error)}. Weaver stays at ${own.tag}.`)
    }

    return null
  }

  private announce(later: PublishedRelease): number {
    const { own } = this.channel

    this.output.say(`Weaver ${later.tag} is published, and this is ${own.tag}: it would be installed.`)
    this.output.say('What it changes in this project is its own to say: once it is installed, weaver update --dry-run shows it.')

    return 0
  }

  // A later release is installed with the script it carries, then finishes the update itself: this one may not know
  // the format it reads.
  private async handOver(later: PublishedRelease): Promise<number> {
    const { source, installer } = this.channel
    const folder = mkdtempSync(join(tmpdir(), 'weaver-update-'))
    const archive = `weaver-${later.tag}.tar.gz`

    try {
      for (const name of [archive, SUMS, INSTALLER]) await source.fetch(later, name, join(folder, name))

      const installed = installer.install(folder, archive)

      for (const line of installed.said) this.output.say(line)
      if (installed.status !== 0) return installed.status
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }

    const finished = installer.start(installer.commandOf(later.tag), ['update', OFFLINE], this.cwd)

    for (const line of finished.said) this.output.say(line)

    return finished.status
  }

  private bringProject(dryRun: boolean): number {
    const repository = Repository.locate(this.cwd)
    const { own } = this.channel

    if (repository === null || !existsSync(DeclarationFolder.in(repository.top).settings)) {
      this.output.say('No supervised project here: weaver install puts Weaver on a project.')

      return 0
    }

    const project = new Project(repository)

    if (project.migrations().isAhead) {
      this.output.say(`${project.configName}/ is in a later format than Weaver ${own.tag} reads, and no later release was installed.`)

      return 1
    }

    const done = [...this.configuration(project, dryRun), ...this.hooks(project, dryRun)]

    for (const line of done) this.output.say(line)
    if (done.length === 0) this.output.say(`This project is up to date with Weaver ${own.tag}.`)
    if (dryRun && done.length > 0) this.output.say('Dry run: nothing was written.')

    return 0
  }

  private configuration(project: Project, dryRun: boolean): string[] {
    const changes = project.bringUpToDate(this.link, !dryRun)
    const head = `${project.configName}/ ${dryRun ? 'would be brought' : 'brought'} up to date:`

    return changes.length === 0 ? [] : [head, ...changes.map((change) => `  ${change}`)]
  }

  // The runtimes that were wired stay wired, to this release: an update plugs nothing in that was not.
  private hooks(project: Project, dryRun: boolean): string[] {
    const stale = new RuntimeCatalog().settings(project.top, this.link, []).filter((runtime) => runtime.wiring() === 'stale')

    return stale.map((runtime) => {
      const from = runtime.wiredTag()

      if (!dryRun) runtime.install()

      return `${runtime.label}: hooks ${dryRun ? 'would be written' : 'written'} again in ${runtime.file}${from === null ? '' : `, which were those of Weaver ${from}`}`
    })
  }
}
