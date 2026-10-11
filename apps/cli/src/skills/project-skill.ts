import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// A file of the project that tells an agent how to do one thing Weaver asks of it.
export abstract class ProjectSkill {
  abstract readonly purpose: string
  readonly path: string
  private readonly file: string

  constructor(top: string, path: string) {
    this.path = path
    this.file = join(top, path)
  }

  get exists(): boolean {
    return existsSync(this.file)
  }

  // The skill is the owner's once it exists: it is never written over.
  create(): boolean {
    if (this.exists) return false

    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, this.template())

    return true
  }

  protected lines(): string[] {
    return readFileSync(this.file, 'utf8')
      .split('\n')
      .map((line) => line.trim())
  }

  protected abstract template(): string
}
