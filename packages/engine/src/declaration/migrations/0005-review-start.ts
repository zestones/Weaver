import { AddedField } from '../migrating/operations/added-field.ts'
import { Migration } from '../migrating/running/migration.ts'

export class ReviewStart extends Migration {
  readonly version = 5
  readonly name = 'review-start'
  readonly summary = 'Reviews start beside the checks by default, after repairs.'
  protected readonly operations = [new AddedField('reviewers', ['start'], 'with-checks', 'the review runs beside the checks')]
}
