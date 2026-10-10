export interface DeclaredCheck {
  readonly id: string
  readonly verify: readonly string[]
  readonly fix: readonly string[] | null
  readonly cwd: string
  readonly when: readonly string[] | null
  readonly reads: 'exit' | 'findings'
  readonly timeoutSeconds: number
  readonly after: string | null
}
