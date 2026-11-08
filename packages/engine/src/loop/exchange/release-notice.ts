import { InstalledRelease } from '../../lib/releases/installed-release.ts'
import { EngineManifest } from '../../unit-of-work/journal/engine-manifest.ts'
import type { Session } from '../../unit-of-work/session/session.ts'

export class ReleaseNotice {
  private readonly installed: InstalledRelease
  private readonly version: string

  constructor(installed = new InstalledRelease(), version = new EngineManifest().version) {
    this.installed = installed
    this.version = version
  }

  forSession(session: Session | null): string | null {
    if (session?.checkRelease() !== true) return null

    const later = this.installed.laterThan(this.version)

    return later === null
      ? null
      : `[weaver] This project runs Weaver v${this.version}; v${later} is installed. Tell the owner to run weaver update in this project after active agents finish.`
  }
}
