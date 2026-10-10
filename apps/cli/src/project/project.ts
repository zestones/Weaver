import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DeclarationError, DeclarationFile, Repository, type Declaration } from '@weaver/engine'
import { FinishSkill } from './finish-skill.ts'

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

    const finish = { headings: FinishSkill.HEADINGS, skill: FinishSkill.PATH }

    writeFileSync(path, `${JSON.stringify({ $schema: schema, version: 1, finish, rules: {}, checks: {}, guards: {} }, null, 2)}\n`)

    return true
  }

  // null when the project names no skill, or when its configuration cannot be read: the doctor says why.
  finishSkill(): FinishSkill | null {
    try {
      const finish = this.declaration()?.finish

      return finish?.skill == null ? null : new FinishSkill(this.top, finish.skill, finish.headings ?? [])
    } catch (error) {
      if (error instanceof DeclarationError) return null

      throw error
    }
  }

  ignores(path: string): boolean {
    return spawnSync('git', ['-C', this.top, 'check-ignore', '-q', path]).status === 0
  }
}
