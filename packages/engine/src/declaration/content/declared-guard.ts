export interface DeclaredGuard {
  readonly id: string
  readonly rule: string
  readonly writes: readonly string[]
  readonly runs: readonly string[]
}
