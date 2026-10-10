export interface Command {
  readonly name: string
  readonly usage: string
  readonly summary: string

  // The exit status of the process.
  run(args: readonly string[]): number
}
