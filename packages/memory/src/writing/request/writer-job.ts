// family -> value -> what the value means.
export type LabelCatalog = Readonly<Record<string, Readonly<Record<string, string>>>>

export interface WriterSettings {
  readonly runtime: 'claude' | 'codex'
  readonly model: string | null
  readonly effort: string | null
  readonly timeoutSeconds: number
  // The file of the project that says how it wants its cards written, relative to the top; null when it names none.
  readonly skill: string | null
  readonly sections: readonly string[]
}

// Plain values only: a job crosses to the process that runs it.
export interface WriterJob {
  readonly top: string
  // Where the registry is: the state folder of Weaver in the repository.
  readonly stateDir: string
  readonly settings: WriterSettings
  readonly labels: LabelCatalog
  // Variables for the environment of the writer: the caller names the one that keeps its own hooks silent.
  readonly environment: Readonly<Record<string, string>>
}
