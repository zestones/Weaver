import type { Finding } from '../../declaration/rules/finding.ts'

// How many findings the author reads at most: the reviewer is told, and what goes past is counted.
export const FINDINGS_LIMIT = 8

export interface ReviewFinding extends Finding {
  // The line as the reviewer read it: it places a finding whose line number drifted.
  readonly quote: string | null
  readonly suggestion: string | null
  // The experiment that shows a finding about what the code does.
  readonly evidence: string | null
}

// What the reviewer could not verify: the owner reads it, the author does not.
export interface Suspicion {
  readonly file: string | null
  readonly note: string
}

export interface Experiment {
  readonly command: string
  readonly observed: string
}
