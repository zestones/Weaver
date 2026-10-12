import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { PartName } from '@weaver/engine'

const MARK = '--weaver'

// A project is wired to one installation of Weaver by absolute paths: a release in its own folder, or a checkout. The
// hook commands and the `$schema` lines belong to this machine and to that installation: they stop working when it
// is removed or when this version of Node is uninstalled, and `weaver install` writes them again after an update.
export class EngineLink {
  readonly hook: string
  // The folder that holds one schema for each file of a declaration.
  readonly schemas: string

  constructor(hook?: string, schemas?: string) {
    const require = createRequire(import.meta.url)

    this.hook = hook ?? require.resolve('@weaver/engine/hook')
    this.schemas = schemas ?? dirname(require.resolve('@weaver/engine/schema/settings.schema.json'))
  }

  schemaOf(part: PartName): string {
    return join(this.schemas, `${part}.schema.json`)
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
