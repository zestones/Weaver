import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface Ran {
  readonly status: number
  readonly said: readonly string[]
}

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

  // Where a release that was installed keeps the file that starts it.
  commandOf(tag: string): string {
    return join(this.env.WEAVER_HOME ?? join(homedir(), '.local/share/weaver'), tag, 'dist/bin/weaver.js')
  }

  // Runs a command of a release, by the file that starts it.
  start(command: string, args: readonly string[], cwd: string): Ran {
    return this.run(process.execPath, [command, ...args], cwd)
  }

  private run(program: string, args: readonly string[], cwd: string): Ran {
    const result = spawnSync(program, args, { cwd, env: this.env, encoding: 'utf8' })
    const said = `${result.stdout}${result.stderr}${result.error === undefined ? '' : `${result.error.message}\n`}`

    return { status: result.status ?? 1, said: said.split('\n').filter((line) => line.trim() !== '') }
  }
}
