interface DocumentCheck {
  readonly verify: readonly string[]
  readonly fix?: readonly string[]
  readonly cwd: string
  readonly when?: readonly string[]
  readonly reads: 'exit' | 'findings'
  readonly timeoutSeconds: number
  readonly after?: string
  readonly rules: Readonly<Record<string, DocumentCheckRule>>
}

// A rule is its sentence, or an object when it says more.
export type DocumentCheckRule = string | { readonly statement: string; readonly level: 'gate' | 'human' }

export type DocumentReviewRule =
  string | { readonly statement: string; readonly scope?: readonly string[]; readonly evidence: boolean; readonly candidates?: string }

interface DocumentGuard {
  readonly statement: string
  readonly writes: readonly string[]
  readonly runs: readonly string[]
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
    readonly rules: Readonly<Record<string, DocumentReviewRule>>
    readonly issue?: readonly string[]
  }
  readonly scripts: { readonly writers: readonly string[]; readonly readers: readonly string[] }
  readonly checks: Readonly<Record<string, DocumentCheck>>
  readonly guards: Readonly<Record<string, DocumentGuard>>
}
