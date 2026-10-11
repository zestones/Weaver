export interface Command {
  // The words that call it: one, or two as in `cards reopen`.
  readonly name: string
  readonly usage: string
  readonly summary: string
  // It decides or changes something: it is the owner's, and does not run under an agent.
  readonly ownerOnly: boolean

  // The exit status of the process.
  run(args: readonly string[]): number
}
