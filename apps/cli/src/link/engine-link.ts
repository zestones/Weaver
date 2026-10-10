import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const MARK = '--weaver'

// TODO(distribution): temporary. Weaver is not distributed yet, so a project is wired to this checkout by absolute
// paths. The hook commands and the `$schema` line belong to this machine, and stop working when the checkout moves, when
// its `dist/` is removed or when this version of Node is uninstalled. Replace them with an installed package and a
// hosted schema once Weaver is published.
export class EngineLink {
  readonly hook: string
  readonly schema: string

  constructor(hook?: string, schema?: string) {
    const require = createRequire(import.meta.url)

    this.hook = hook ?? require.resolve('@weaver/engine/hook')
    this.schema = schema ?? require.resolve('@weaver/engine/weaver.config.schema.json')
  }

  command(event: string, agent: string): string {
    return `${JSON.stringify(process.execPath)} ${JSON.stringify(this.hook)} ${event} --agent=${agent} ${MARK}`
  }

  owns(command: string): boolean {
    return command.split(' ').includes(MARK)
  }

  // An event the loop does not know makes the hook start, load everything and answer nothing.
  isAlive(): boolean {
    return existsSync(this.hook) && spawnSync(process.execPath, [this.hook, 'Ping'], { input: '' }).status === 0
  }
}
