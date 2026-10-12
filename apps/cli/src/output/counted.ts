// A count with the word it counts, in the singular or the plural: `1 card`, `3 cards`.
export class Counted {
  readonly text: string

  constructor(count: number, singular: string, plural = `${singular}s`) {
    this.text = `${String(count)} ${count === 1 ? singular : plural}`
  }
}
