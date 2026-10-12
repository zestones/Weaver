import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  DeclarationError,
  DeclarationFolder,
  DeclarationMigrations,
  DeclarationParts,
  Repository,
  type Declaration,
  type PartName,
} from '@weaver/engine'
import { CardRegistry } from '@weaver/memory'
import type { EngineLink } from '../link/engine-link.ts'
import { CardSkill } from '../skills/card-skill.ts'
import { FinishSkill } from '../skills/finish-skill.ts'
import type { ProjectSkill } from '../skills/project-skill.ts'
import { ReviewSkill } from '../skills/review-skill.ts'

// What a new project starts with: every limit Weaver applies is written in its settings, where the owner changes it.
const STARTING_LIMITS = { maxRefusals: 3, totalTimeoutSeconds: 1200, parallel: 3, warnTimeoutSeconds: 30 }
// The database the registry keeps in the state folder.
const REGISTRY_FILE = 'registry.sqlite'

export class Project {
  readonly repository: Repository

  constructor(repository: Repository) {
    this.repository = repository
  }

  static locate(cwd: string): Project {
    const repository = Repository.locate(cwd)

    if (repository === null) throw new Error(`${cwd} is not inside a git repository`)

    return new Project(repository)
  }

  get top(): string {
    return this.repository.top
  }

  get configName(): string {
    return DeclarationFolder.NAME
  }

  declaration(): Declaration | null {
    return DeclarationFolder.in(this.top).load()
  }

  // The format the files of the declaration are in, and the migrations they lack.
  migrations(): DeclarationMigrations {
    return new DeclarationMigrations(DeclarationFolder.in(this.top).texts())
  }

  // Brings the declaration up to date with this Weaver: the migrations it lacks, then the `$schema` lines that name
  // another installation. What that changes, for the owner who reads the diff; nothing is written unless asked.
  bringUpToDate(link: EngineLink, write: boolean): string[] {
    const folder = DeclarationFolder.in(this.top)
    const { texts, applied } = new DeclarationMigrations(folder.texts()).run()
    const pointed = this.pointedAt(link, { ...folder.texts(), ...texts })
    const files = Object.keys(pointed).length

    if (write) folder.write({ ...texts, ...pointed })

    return [
      ...applied.flatMap((migration) => [`${migration.label}: ${migration.summary}`, ...migration.changes.map((change) => `  ${change}`)]),
      ...(files === 0 ? [] : [`the \`$schema\` lines point at the schemas of this Weaver, in ${String(files)} file(s)`]),
    ]
  }

  // The files whose `$schema` line names another installation, written again with the schemas of this one.
  private pointedAt(link: EngineLink, texts: Readonly<Partial<Record<PartName, string>>>): Partial<Record<PartName, string>> {
    const pointed: Partial<Record<PartName, string>> = {}

    for (const [part, text] of Object.entries(texts) as [PartName, string][]) {
      const document = this.documentOf(text)

      if (document !== null && typeof document.$schema === 'string' && document.$schema !== link.schemaOf(part)) {
        pointed[part] = `${JSON.stringify({ ...document, $schema: link.schemaOf(part) }, null, 2)}\n`
      }
    }

    return pointed
  }

  private documentOf(text: string): Record<string, unknown> | null {
    try {
      const value: unknown = JSON.parse(text)

      return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
    } catch {
      return null
    }
  }

  // The settings, and one empty file for each part of what the project asks, each naming the schema an editor checks
  // it against. Who reviews and who writes the cards are the owner's to add: both cost money.
  createConfig(link: EngineLink): boolean {
    const folder = DeclarationFolder.in(this.top)
    const starter: Readonly<Partial<Record<PartName, object>>> = {
      settings: { version: DeclarationMigrations.LATEST, finish: { skill: FinishSkill.PATH }, checks: STARTING_LIMITS },
      guards: {},
      checks: {},
      scripts: {},
      labels: {},
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

  cardSkill(): CardSkill | null {
    const writer = this.readableDeclaration()?.writer

    return writer?.skill == null ? null : new CardSkill(this.top, writer.skill, writer.sections)
  }

  skills(): ProjectSkill[] {
    return [this.finishSkill(), this.reviewSkill(), this.cardSkill()].flatMap((skill) => skill ?? [])
  }

  // Creates the registry when nothing was recorded yet. Whoever opens it closes it.
  registry(): CardRegistry {
    return new CardRegistry(this.repository.stateDir)
  }

  // null while nothing was recorded: a command that only reads creates nothing.
  recordedRegistry(): CardRegistry | null {
    return existsSync(join(this.repository.stateDir, REGISTRY_FILE)) ? this.registry() : null
  }

  // The text of a file by its path from the top; null when it is not there.
  read(path: string): string | null {
    try {
      return readFileSync(join(this.top, path), 'utf8')
    } catch {
      return null
    }
  }

  // Whether git is told to ignore the path. A file committed before it was ignored is still followed: see `tracks`.
  ignores(path: string): boolean {
    return spawnSync('git', ['-C', this.top, 'check-ignore', '-q', '--no-index', path]).status === 0
  }

  tracks(path: string): boolean {
    return spawnSync('git', ['-C', this.top, 'ls-files', '--error-unmatch', '--', path]).status === 0
  }
}
