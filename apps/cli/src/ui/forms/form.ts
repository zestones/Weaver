import type { Key } from 'ink'

// A small box that takes the keys until the owner is done with it or leaves it.
export interface Form {
  // open: it takes the next key. submitted: the owner asks for what it holds. cancelled: the owner left it.
  readonly outcome: 'open' | 'submitted' | 'cancelled'
  // What went wrong when what it holds was asked for; null while nothing did.
  readonly problem: string | null
  pressed(input: string, key: Key): Form
  // The same box, open again, with what kept it from being done.
  refused(problem: string): Form
}
