export interface DeclaredCheck {
  readonly id: string
  readonly run: readonly string[]
  readonly cwd: string
  readonly when: readonly string[] | null
  readonly reads: 'exit' | 'findings'
  readonly timeoutSeconds: number
  readonly after: string | null
}
