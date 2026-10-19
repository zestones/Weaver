// The progress Weaver keeps of an end of task, in progress.json of the folder of the session: the shape its engine
// writes, read as it is.
export type CheckProgress = {
  id: string
  status: 'pass' | 'fail' | 'timeout' | 'skip' | 'waiting' | 'running'
  startedAt: string | null
  ms: number | null
  kept: boolean
  usualMs: number | null
}

export type ReviewProgress = {
  status: 'waiting' | 'running' | 'over'
  startedAt: string | null
  endedAt: string | null
  standing: string | null
  reviewer: string | null
  usualMs: number | null
}

export type Progress = {
  unit: number
  pid: number
  startedAt: string
  usualMs: number | null
  step: 'repairs' | 'checks' | 'review' | 'over'
  checks: CheckProgress[]
  review: ReviewProgress | null
  endedAt: string | null
  outcome: string | null
}

// The Stop hook that runs: the file of the progress of its end of task, and since when it runs.
export type Watch = { file: string; since: number }

// What the chat shows: the progress as it was last read, and when.
export type Shown = { progress: Progress; at: number }

declare module 'claude-code' {
  interface PluginState {
    'weaver-status': { watch: Watch | null; shown: Shown | null; isHidden: boolean }
  }
}
