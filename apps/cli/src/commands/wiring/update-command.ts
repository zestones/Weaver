import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DeclarationFolder, Repository } from '@weaver/engine'
import type { EngineLink } from '../../link/engine-link.ts'
import type { Output } from '../../output/output.ts'
import { Screen } from '../../output/screen.ts'
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
  readonly summary = 'Bring Weaver and this project up to date'
  readonly ownerOnly = true
  readonly help = {
    group: 'Set up',
    description: 'Bring Weaver and this project up to date: the latest release, the migrations of the configuration, the hooks.',
    words: [
      [DRY_RUN, 'Show what would change, and write nothing'],
      [OFFLINE, 'Look for no release: bring this project to the Weaver that is installed'],
    ],
    examples: ['weaver update', `weaver update ${DRY_RUN}`],
  } as const
  private readonly cwd: string
  private readonly screen: Screen
  private readonly link: EngineLink
  private readonly channel: ReleaseChannel

  constructor(cwd: string, output: Output, link: EngineLink, channel: ReleaseChannel) {
    this.cwd = cwd
    this.screen = new Screen(output)
    this.link = link
    this.channel = channel
  }

  async run(args: readonly string[]): Promise<number> {
    const unknown = args.find((arg) => arg !== DRY_RUN && arg !== OFFLINE)

    if (unknown !== undefined) {
      this.screen.misuse(this.name, this.usage, `weaver update does not know ${unknown}.`)

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
      this.screen.note('Weaver runs from a checkout, which git updates: no release is looked for.')

      return null
    }

    try {
      const latest = await source.latest()

      if (own.isOlderThan(latest.tag)) return latest

      this.screen.done(`Weaver ${own.tag} is the latest release.`)
    } catch (error) {
      this.screen.alert(`No release was looked for: ${error instanceof Error ? error.message : String(error)}. Weaver stays at ${own.tag}.`)
    }

    return null
  }

  // What a later release would change here is its own to say: this one does not hold its migrations. So the release
  // is unpacked in a temporary folder, where nothing is installed, and asked for its own dry run on this project.
  private async announce(later: PublishedRelease): Promise<number> {
    const { own, source, installer } = this.channel
    const folder = mkdtempSync(join(tmpdir(), 'weaver-update-'))
    const archive = `weaver-${later.tag}.tar.gz`

    this.screen.note(`Weaver ${later.tag} is published, and this is ${own.tag}: it would be installed.`)
    this.notes(later)

    try {
      for (const name of [archive, SUMS]) await source.fetch(later, name, join(folder, name))

      const unpacked = installer.unpack(folder, archive)

      if (unpacked.command === null) {
        this.screen.error(`Weaver ${later.tag} could not be asked what it would change.`, ...unpacked.said)

        return 1
      }

      const asked = installer.start(unpacked.command, [this.name, DRY_RUN, OFFLINE], this.cwd)

      this.screen.heading(`What Weaver ${later.tag} would change in this project`)
      for (const line of asked.said) this.screen.line(`  ${line}`)

      return asked.status
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  }

  // What the release says changed, as its publisher wrote it: how it is installed is not what a dry run is asked.
  private notes(later: PublishedRelease): void {
    const from = later.notes.search(/^## What changed/m)
    const changed = (from === -1 ? later.notes : later.notes.slice(from)).trim()

    for (const line of changed === '' ? [] : changed.split('\n')) {
      const heading = /^#+ +(.*)$/.exec(line)

      if (heading !== null) this.screen.heading(heading[1] ?? '')
      else if (line.trim() !== '') this.screen.line(`  ${line}`)
    }
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

      for (const line of installed.said) this.screen.line(line)
      if (installed.status !== 0) return installed.status
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }

    const finished = installer.start(installer.commandOf(later.tag), ['update', OFFLINE], this.cwd)

    for (const line of finished.said) this.screen.line(line)

    return finished.status
  }

  private bringProject(dryRun: boolean): number {
    const repository = Repository.locate(this.cwd)
    const { own } = this.channel

    if (repository === null || !existsSync(DeclarationFolder.in(repository.top).settings)) {
      this.screen.note('No supervised project here: weaver install puts Weaver on a project.')

      return 0
    }

    const project = new Project(repository)

    if (project.migrations().isAhead) {
      this.screen.error(`${project.configName}/ is in a later format than Weaver ${own.tag} reads, and no later release was installed.`)

      return 1
    }

    const changed = [this.configuration(project, dryRun), this.hooks(project, dryRun), this.guides(project, dryRun)].includes(true)

    if (!changed) this.screen.done(`This project is up to date with Weaver ${own.tag}.`)
    if (dryRun && changed) this.screen.hint('Dry run: nothing was written.')

    return 0
  }

  // What is done is marked as done, and what a dry run would do as only told. True when there was something to do.
  private told(text: string, dryRun: boolean): void {
    if (dryRun) this.screen.note(text)
    else this.screen.done(text)
  }

  private configuration(project: Project, dryRun: boolean): boolean {
    const changes = project.bringUpToDate(this.link, !dryRun)

    if (changes.length === 0) return false

    this.told(`${project.configName}/ ${dryRun ? 'would be brought' : 'brought'} up to date:`, dryRun)
    for (const change of changes) this.screen.line(`  ${change}`)

    return true
  }

  // The runtimes that were wired stay wired, to this release: an update plugs nothing in that was not.
  private hooks(project: Project, dryRun: boolean): boolean {
    const stale = new RuntimeCatalog().settings(project.top, this.link, []).filter((runtime) => runtime.wiring() === 'stale')

    for (const runtime of stale) {
      const from = runtime.wiredTag()

      if (!dryRun) runtime.install()

      this.told(
        `${runtime.label}: hooks ${dryRun ? 'would be written' : 'written'} again in ${runtime.file}${from === null ? '' : `, which were those of Weaver ${from}`}`,
        dryRun,
      )
    }

    return stale.length > 0
  }

  // The guide of each runtime that is wired says what this release does, with what the project declares now.
  private guides(project: Project, dryRun: boolean): boolean {
    const wired = new RuntimeCatalog().settings(project.top, this.link, []).filter((runtime) => runtime.wiring() !== 'absent')
    const behind = wired.flatMap((runtime) => {
      const guide = project.guide(runtime.guide)
      const state = guide?.state() ?? 'current'

      return guide === null || state === 'current' ? [] : [{ runtime, guide, again: state === 'stale' }]
    })

    for (const { runtime, guide, again } of behind) {
      if (!dryRun) guide.write()

      const done = `${dryRun ? 'would be written' : 'written'}${again ? ' again in' : ' to'}`

      this.told(`${runtime.label}: the guide of Weaver ${done} ${guide.path}`, dryRun)
    }

    return behind.length > 0
  }
}
