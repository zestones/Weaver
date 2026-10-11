// What the author says of one finding, by its number.
export interface FindingAnswer {
  readonly finding: number
  readonly status: 'fixed' | 'not-fixed'
  readonly why: string
}
