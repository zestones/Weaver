// A run of text with no space in it, as it is drawn and as wide as it reads: what a line is filled with, and never cut.
export interface Atom {
  readonly text: string
  readonly width: number
}
