import { AddedPart } from '../migrating/operations/added-part.ts'
import { Migration } from '../migrating/running/migration.ts'

export class DefaultWriter extends Migration {
  readonly version = 3
  readonly name = 'default-writer'
  readonly summary = 'Codex writes waiting flags in bounded batches; an explicit disabled writer stays disabled.'
  protected readonly operations = [
    new AddedPart(
      'writer',
      { runtime: 'codex', timeoutSeconds: 300, batches: 4 },
      'added the Codex writer, using its configured model, at four batches of five flags per start',
    ),
  ]
}
