import type { Place } from './flag-record.ts'

// Reads a place as an agent writes it: `path`, `path:12`.
export class PlaceText {
  static write(place: Place): string {
    return place.line === null ? place.file : `${place.file}:${String(place.line)}`
  }

  // The path as written: the caller resolves it against the repository.
  readonly path: string
  readonly line: number | null

  // An agent may point at a column or at a range of lines, `path:12:5` or `path:12-20`: the first line is the place.
  constructor(text: string) {
    const written = text.trim()
    const [, path, digits] = /^(.+?):(\d+)(?:[:-]\d+)?$/.exec(written) ?? []
    const line = Number(digits ?? 0)

    this.path = path ?? written
    this.line = line >= 1 ? line : null
  }
}
