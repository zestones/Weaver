export type PartName = 'settings' | 'guards' | 'checks' | 'scripts' | 'reviewers' | 'rules'

// A rule is its sentence, or an object when it says more.
export type DocumentCheckRule = string | { readonly statement: string; readonly level: 'gate' | 'human' }

export type DocumentReviewRule =
  string | { readonly statement: string; readonly scope?: readonly string[]; readonly evidence: boolean; readonly candidates?: string }

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

interface DocumentGuard {
  readonly statement: string
  readonly writes: readonly string[]
  readonly runs: readonly string[]
}

interface DocumentReviewer {
  readonly model?: string
  readonly effort?: string
}

// What each file of `.weaver/` holds. Every limit Weaver applies is written in the file; what may be left out is what
// means "none" when it is. A file that names its schema carries a `$schema` line, which is no entry of the file.
export interface SettingsDocument {
  readonly version: 1
  readonly finish: { readonly skill?: string }
  readonly checks: {
    readonly maxRefusals: number
    readonly totalTimeoutSeconds: number
    readonly parallel: number
  }
}

export type GuardsDocument = Readonly<Record<string, DocumentGuard>>

export type ChecksDocument = Readonly<Record<string, DocumentCheck>>

export interface ScriptsDocument {
  readonly writers: readonly string[]
  readonly readers: readonly string[]
  readonly scope: { readonly exclude: readonly string[] }
}

export interface ReviewersDocument {
  readonly runtime: 'claude' | 'codex' | 'same' | 'other'
  readonly reviewers: { readonly claude?: DocumentReviewer; readonly codex?: DocumentReviewer }
  readonly critical: { readonly paths: readonly string[]; readonly lines?: number }
  readonly experiments: boolean
  readonly timeoutSeconds: number
  readonly waitSeconds: number
  readonly maxRefusals: number
  readonly skill?: string
  readonly issue?: readonly string[]
}

export type RulesDocument = Readonly<Record<string, DocumentReviewRule>>
