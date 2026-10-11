export interface DeclaredGuard {
  readonly id: string
  // The rule the guard holds, as it is told to the agent it refuses.
  readonly statement: string
  readonly writes: readonly string[]
  readonly runs: readonly string[]
}
