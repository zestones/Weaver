import { AddedField } from '../migrating/operations/added-field.ts'
import { Migration } from '../migrating/running/migration.ts'

export class CardResolution extends Migration {
  readonly version = 4
  readonly name = 'card-resolution'
  readonly summary = 'The project chooses how many cards agents resolve per task, unlimited by default.'
  protected readonly operations = [
    new AddedField('settings', ['cards'], { resolvePerTask: null }, 'all eligible cards are resolved at task end'),
  ]
}
