import { accessSync, constants, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { compareVersions } from './release-version.ts'

export class InstalledRelease {
  private readonly root: string
  private readonly path: string

  constructor(root = process.env.WEAVER_HOME ?? join(homedir(), '.local/share/weaver'), path = process.env.PATH ?? '') {
    this.root = root
    this.path = path
  }

  laterThan(version: string): string | null {
    if (version === '0.0.0-dev') return null

    const selected = this.selected()
    const roots = new Set([this.root, ...(selected === null ? [] : [dirname(selected)])])
    const installed = [...roots].flatMap((root) => {
      try {
        return readdirSync(root).map((tag) => this.versionAt(join(root, tag)))
      } catch {
        return []
      }
    })
    const versions = [...installed, selected === null ? null : this.versionAt(selected)]

    return versions.reduce<string | null>(
      (latest, candidate) => (candidate !== null && (compareVersions(candidate, latest ?? version) ?? 0) > 0 ? candidate : latest),
      null,
    )
  }

  private selected(): string | null {
    for (const folder of this.path.split(delimiter)) {
      const command = join(folder, 'weaver')

      try {
        accessSync(command, constants.X_OK)
        if (!statSync(command).isFile()) continue

        const target = realpathSync(command)

        return target.endsWith('/dist/bin/weaver.js') ? dirname(dirname(dirname(target))) : null
      } catch {
        continue
      }
    }

    return null
  }

  private versionAt(root: string): string | null {
    try {
      const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown }

      return manifest.name === '@weaver/cli' && typeof manifest.version === 'string' && statSync(join(root, 'dist/bin/weaver.js')).isFile()
        ? manifest.version
        : null
    } catch {
      return null
    }
  }
}
