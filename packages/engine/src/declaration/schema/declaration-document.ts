interface DocumentCheck {
  readonly verify: readonly string[]
  readonly fix?: readonly string[]
  readonly cwd: string
  readonly when?: readonly string[]
  readonly reads: 'exit' | 'findings'
  readonly timeoutSeconds: number
  readonly after?: string
}

interface DocumentGuard {
  readonly rule: string
  readonly writes: readonly string[]
  readonly runs: readonly string[]
}

interface DocumentRule {
  readonly level: 'gate' | 'llm' | 'human'
  readonly statement: string
  readonly source?: string
  readonly scope?: readonly string[]
  readonly check?: string
  readonly evidence: boolean
}

interface DocumentReviewer {
  readonly model?: string
  readonly effort?: string
  readonly maxTurns?: number
  readonly maxCostUsd?: number
}

// The shape `weaver.config.schema.json` describes, once the defaults it gives are filled in.
export interface DeclarationDocument {
  readonly version: 1
  readonly scope: { readonly exclude: readonly string[] }
  readonly finish: {
    readonly headings?: readonly string[]
    readonly skill?: string
    readonly maxRounds: number
    readonly deadlineSeconds: number
    readonly concurrency: number
  }
  readonly review?: {
    readonly runtime: 'claude' | 'codex' | 'same' | 'other'
    readonly reviewers: { readonly claude?: DocumentReviewer; readonly codex?: DocumentReviewer }
    readonly critical: { readonly paths: readonly string[]; readonly lines?: number }
    readonly experiments: boolean
    readonly timeoutSeconds: number
    readonly waitSeconds: number
    readonly maxRounds: number
    readonly skill?: string
    readonly issue?: readonly string[]
  }
  readonly scripts: { readonly writers: readonly string[]; readonly readers: readonly string[] }
  readonly checks: Readonly<Record<string, DocumentCheck>>
  readonly guards: Readonly<Record<string, DocumentGuard>>
  readonly rules: Readonly<Record<string, DocumentRule>>
}
