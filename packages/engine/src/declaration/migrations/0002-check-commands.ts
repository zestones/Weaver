import { AddedField } from '../migrating/operations/added-field.ts'
import { RenamedField } from '../migrating/operations/renamed-field.ts'
import { Migration } from '../migrating/running/migration.ts'

export class CheckCommands extends Migration {
  readonly version = 2
  readonly name = 'check-commands'
  readonly summary = 'The commands of a check are named for what they do, and a check may warn right after a call.'
  protected readonly operations = [
    new RenamedField('checks', 'fix', 'repair'),
    new RenamedField('checks', 'verify', 'judge'),
    new AddedField('settings', ['checks', 'warnTimeoutSeconds'], 30, 'the seconds the checks that warn are given after one call'),
  ]
}
