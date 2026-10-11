import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DeclarationError, DeclarationFile, Repository, ReviewLedger, type Declaration } from '@weaver/engine'
import { FinishSkill } from '../skills/finish-skill.ts'
import type { ProjectSkill } from '../skills/project-skill.ts'
import { ReviewSkill } from '../skills/review-skill.ts'

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

    writeFileSync(path, `${JSON.stringify({ $schema: schema, version: 1, finish, checks: {}, guards: {} }, null, 2)}\n`)

    return true
  }

  // null when there is no configuration, or when it cannot be read: the doctor says why.
  readableDeclaration(): Declaration | null {
    try {
      return this.declaration()
    } catch (error) {
      if (error instanceof DeclarationError) return null

      throw error
    }
  }

  finishSkill(): FinishSkill | null {
    const finish = this.readableDeclaration()?.finish

    return finish?.skill == null ? null : new FinishSkill(this.top, finish.skill, finish.headings ?? [])
  }

  reviewSkill(): ReviewSkill | null {
    const skill = this.readableDeclaration()?.review?.skill ?? null

    return skill === null ? null : new ReviewSkill(this.top, skill)
  }

  skills(): ProjectSkill[] {
    return [this.finishSkill(), this.reviewSkill()].flatMap((skill) => skill ?? [])
  }

  reviewLedger(): ReviewLedger {
    const repo = Repository.locate(this.top)

    if (repo === null) throw new Error(`${this.top} is not inside a git repository`)

    return new ReviewLedger(repo)
  }

  ignores(path: string): boolean {
    return spawnSync('git', ['-C', this.top, 'check-ignore', '-q', path]).status === 0
  }
}
