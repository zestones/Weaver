import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DeclarationFile, Repository, type Declaration } from '@weaver/engine'

export class Project {
  readonly top: string

  constructor(top: string) {
    this.top = top
  }

  static locate(cwd: string): Project {
    const repo = Repository.locate(cwd)

    if (repo === null) throw new Error(`${cwd} is not inside a git repository`)

    return new Project(repo.top)
  }

  get configName(): string {
    return DeclarationFile.NAME
  }

  declaration(): Declaration | null {
    return DeclarationFile.in(this.top).load()
  }

  createConfig(schema: string): boolean {
    const path = join(this.top, this.configName)

    if (existsSync(path)) return false

    writeFileSync(path, `${JSON.stringify({ $schema: schema, version: 1, rules: {}, checks: {}, guards: {} }, null, 2)}\n`)

    return true
  }

  ignores(path: string): boolean {
    return spawnSync('git', ['-C', this.top, 'check-ignore', '-q', path]).status === 0
  }
}
