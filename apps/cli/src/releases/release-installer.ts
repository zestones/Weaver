import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface Ran {
  readonly status: number
  readonly said: readonly string[]
}

// A release unpacked to be asked something, and installed nowhere.
export interface Unpacked {
  // The file that starts the copy; null when it was not unpacked, and `said` tells why.
  readonly command: string | null
  readonly said: readonly string[]
}

const SUMS = 'SHA256SUMS'

// Puts a release that was fetched on this machine, with the script the release itself carries, then starts it.
export class ReleaseInstaller {
  private readonly env: NodeJS.ProcessEnv

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.env = env
  }

  // Runs the `install.sh` of the release on its archive, both in `folder`.
  install(folder: string, archive: string): Ran {
    return this.run('bash', ['install.sh', archive], folder)
  }

  // Unpacks the archive of a release where it lies, in `folder`, and installs nothing. The archive must be the one its
  // release published: it is compared with the sums beside it before anything of it is run.
  unpack(folder: string, archive: string): Unpacked {
    if (!this.matchesSums(folder, archive)) {
      return { command: null, said: [`${archive} does not match the ${SUMS} of its release: nothing of it is run.`] }
    }

    const extracted = this.run('tar', ['-xzf', archive], folder)

    return extracted.status === 0
      ? { command: join(folder, archive.replace(/\.tar\.gz$/, ''), 'dist/bin/weaver.js'), said: [] }
      : { command: null, said: extracted.said }
  }

  // Where a release that was installed keeps the file that starts it.
  commandOf(tag: string): string {
    return join(this.env.WEAVER_HOME ?? join(homedir(), '.local/share/weaver'), tag, 'dist/bin/weaver.js')
  }

  // Runs a command of a release, by the file that starts it.
  start(command: string, args: readonly string[], cwd: string): Ran {
    return this.run(process.execPath, [command, ...args], cwd)
  }

  private matchesSums(folder: string, archive: string): boolean {
    if (!existsSync(join(folder, SUMS))) return false

    const listed = readFileSync(join(folder, SUMS), 'utf8')
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .find(([, name]) => name === archive)

    return (
      listed?.[0] ===
      createHash('sha256')
        .update(readFileSync(join(folder, archive)))
        .digest('hex')
    )
  }

  private run(program: string, args: readonly string[], cwd: string): Ran {
    const result = spawnSync(program, args, { cwd, env: this.env, encoding: 'utf8' })
    const said = `${result.stdout}${result.stderr}${result.error === undefined ? '' : `${result.error.message}\n`}`

    return { status: result.status ?? 1, said: said.split('\n').filter((line) => line.trim() !== '') }
  }
}
