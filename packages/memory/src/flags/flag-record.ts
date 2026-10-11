export interface Place {
  // Relative to the top of the repository.
  readonly file: string
  readonly line: number | null
}

export type Did = 'left' | 'worked-around' | 'fixed'

export interface FlagFields {
  readonly seen: string
  readonly expected: string
  readonly found: string
  readonly checked: string
  readonly did: Did
  // What the agent wrote after the value of `Did`, if anything.
  readonly didNote: string | null
}

export interface CommitNote {
  readonly hash: string
  readonly date: string
  readonly subject: string
}

// What the caller computed about one place at the moment of the flag. Frozen: the repository goes on changing.
export interface PlaceContext {
  readonly place: Place
  // false when the file is not there.
  readonly exists: boolean
  // The flagged line and a few around it, as they were; '' without a line or a file.
  readonly excerpt: string
  // The text of the flagged line itself, to tell later whether the place has changed; null without a line.
  readonly lineText: string | null
  // before: the lines were there before the unit of work. unit: the unit wrote them. unknown: cannot be told.
  readonly origin: 'before' | 'unit' | 'unknown'
  readonly wroteBy: readonly CommitNote[]
  readonly lastCommits: readonly CommitNote[]
}

export interface FlagRecord {
  readonly fields: FlagFields
  // The body of the flag, word for word.
  readonly text: string
  readonly context: readonly PlaceContext[]
}
