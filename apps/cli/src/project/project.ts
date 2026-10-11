import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  DeclarationError,
  DeclarationFolder,
  DeclarationParts,
  Repository,
  ReviewLedger,
  type Declaration,
  type PartName,
} from '@weaver/engine'
import type { EngineLink } from '../link/engine-link.ts'
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
    return DeclarationFolder.NAME
  }

  declaration(): Declaration | null {
    return DeclarationFolder.in(this.top).load()
  }

  // The settings, and one empty file for each part of what the project asks, each naming the schema an editor checks
  // it against. Who reviews is the owner's to add: a review costs money.
  createConfig(link: EngineLink): boolean {
    const folder = DeclarationFolder.in(this.top)
    const starter: Readonly<Partial<Record<PartName, object>>> = {
      settings: { version: 1, finish: { skill: FinishSkill.PATH } },
      guards: {},
      checks: {},
      scripts: {},
    }

    if (existsSync(folder.settings)) return false

    for (const [part, content] of Object.entries(starter) as [PartName, object][]) {
      const path = join(folder.path, DeclarationParts.FILES[part])

      mkdirSync(dirname(path), { recursive: true })
      if (!existsSync(path)) writeFileSync(path, `${JSON.stringify({ $schema: link.schemaOf(part), ...content }, null, 2)}\n`)
    }

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

    return finish?.skill == null ? null : new FinishSkill(this.top, finish.skill, finish.headings ?? FinishSkill.HEADINGS)
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
