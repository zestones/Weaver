export interface DeclaredCheck {
  readonly id: string
  readonly warn: readonly string[] | null
  readonly repair: readonly string[] | null
  readonly judge: readonly string[]
  readonly cwd: string
  readonly when: readonly string[] | null
  readonly reads: 'exit' | 'findings'
  readonly timeoutSeconds: number
  readonly after: string | null
}
