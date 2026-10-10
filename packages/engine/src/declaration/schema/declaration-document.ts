interface DocumentCheck {
  readonly run: readonly string[]
  readonly cwd: string
  readonly when?: readonly string[]
  readonly reads: 'exit' | 'findings'
  readonly timeoutSeconds: number
  readonly after?: string
}

interface DocumentRule {
  readonly level: 'gate' | 'llm' | 'human'
  readonly statement: string
  readonly source?: string
  readonly scope?: readonly string[]
  readonly check?: string
}

// The shape `weaver.config.schema.json` describes, once the defaults it gives are filled in.
export interface DeclarationDocument {
  readonly version: 1
  readonly scope: { readonly exclude: readonly string[] }
  readonly finish: {
    readonly headings?: readonly string[]
    readonly maxRounds: number
    readonly deadlineSeconds: number
    readonly concurrency: number
  }
  readonly commands: { readonly generators: readonly string[]; readonly readers: readonly string[] }
  readonly checks: Readonly<Record<string, DocumentCheck>>
  readonly rules: Readonly<Record<string, DocumentRule>>
}
