import { OwnRelease } from '../link/own-release.ts'
import { GithubReleases } from './github-releases.ts'
import { ReleaseInstaller } from './release-installer.ts'
import type { ReleaseSource } from './release-source.ts'

// What an update needs: where the releases are published, how one is installed, and which one is running.
export class ReleaseChannel {
  readonly source: ReleaseSource
  readonly installer: ReleaseInstaller
  readonly own: OwnRelease

  constructor(source: ReleaseSource = new GithubReleases(), installer = new ReleaseInstaller(), own = new OwnRelease()) {
    this.source = source
    this.installer = installer
    this.own = own
  }
}
