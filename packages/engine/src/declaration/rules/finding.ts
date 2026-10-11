// What was seen at one place of a unit's diff, under the rule it names: by a check, or by a reviewer.
export interface Finding {
  readonly rule: string
  readonly file: string
  readonly line?: number
  readonly message: string
}
