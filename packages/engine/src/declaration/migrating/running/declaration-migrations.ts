import { CheckCommands } from '../../migrations/0002-check-commands.ts'
import { DeclarationParts, type PartTexts } from '../../reading/declaration-parts.ts'
import type { PartName } from '../../schema/declaration-document.ts'
import type { PartDocuments } from '../operations/operation.ts'
import type { Migration } from './migration.ts'

interface AppliedMigration {
  readonly label: string
  readonly summary: string
  // What it changed, each with the file it is in.
  readonly changes: readonly string[]
}

export interface MigrationRun {
  // The files that changed, as they are now written.
  readonly texts: PartTexts
  readonly applied: readonly AppliedMigration[]
}

// The format the files of a declaration are written in, which `version` names in the settings, and the migrations
// that bring files of an earlier version to the one this Weaver reads. A change an earlier Weaver could not read is a
// new version, and comes with its migration.
export class DeclarationMigrations {
  // In order, one per version. A migration is never edited once a release carries it.
  static readonly ALL: readonly Migration[] = [new CheckCommands()]
  // The version before any migration.
  private static readonly FIRST = 1
  static readonly LATEST = DeclarationMigrations.ALL.at(-1)?.version ?? DeclarationMigrations.FIRST

  private readonly texts: PartTexts

  constructor(texts: PartTexts) {
    this.texts = texts
  }

  // The version the settings name; null when they are not there or do not say.
  get written(): number | null {
    const { version } = this.parsed(this.texts.settings) ?? {}

    return typeof version === 'number' && Number.isInteger(version) ? version : null
  }

  get isBehind(): boolean {
    return this.written !== null && this.written < DeclarationMigrations.LATEST
  }

  get isAhead(): boolean {
    return this.written !== null && this.written > DeclarationMigrations.LATEST
  }

  // The migrations these files lack, in the order they are applied.
  pending(): Migration[] {
    const { written } = this

    return written === null ? [] : DeclarationMigrations.ALL.filter((migration) => migration.version > written)
  }

  // The files brought to the version this Weaver reads, one migration after the other. A file that is not JSON is
  // left as it is: reading the declaration says what is wrong with it.
  run(): MigrationRun {
    const documents: PartDocuments = {}

    for (const [part, text] of Object.entries(this.texts) as [PartName, string][]) {
      const document = this.parsed(text)

      if (document !== null) documents[part] = document
    }

    const before = Object.fromEntries(Object.entries(documents).map(([part, document]) => [part, JSON.stringify(document)]))
    const applied = this.pending().map((migration): AppliedMigration => {
      const changes = migration.apply(documents).map((change) => `${DeclarationParts.FILES[change.part]}: ${change.text}`)

      documents.settings = { ...documents.settings, version: migration.version }

      return { label: migration.label, summary: migration.summary, changes }
    })
    const rewritten = Object.entries(documents).filter(([part, document]) => JSON.stringify(document) !== before[part])

    return { texts: Object.fromEntries(rewritten.map(([part, document]) => [part, `${JSON.stringify(document, null, 2)}\n`])), applied }
  }

  private parsed(text: string | undefined): Record<string, unknown> | null {
    try {
      const value: unknown = JSON.parse(text ?? '')

      return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
}
