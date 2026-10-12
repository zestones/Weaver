// Rows of words under their headings, each column as wide as its widest word. The first column names the row and
// starts on the left, as does a column of words; the others are figures and end on the right.
export class TextTable {
  private readonly rows: string[][]
  private readonly worded: ReadonlySet<number>

  // `words` are the headings of the columns that hold words, besides the first.
  constructor(headings: readonly string[], words: readonly string[] = []) {
    this.rows = [[...headings]]
    this.worded = new Set([0, ...words.map((heading) => headings.indexOf(heading))])
  }

  add(cells: readonly (string | number)[]): this {
    this.rows.push(cells.map(String))

    return this
  }

  get isEmpty(): boolean {
    return this.rows.length === 1
  }

  lines(indent = ''): string[] {
    const widths = (this.rows[0] ?? []).map((_, column) => Math.max(...this.rows.map((row) => (row[column] ?? '').length)))

    const drawn = (cell: string, column: number): string =>
      this.worded.has(column) ? cell.padEnd(widths[column] ?? 0) : cell.padStart(widths[column] ?? 0)

    return this.rows.map((row) => `${indent}${row.map(drawn).join('  ')}`.trimEnd())
  }
}
