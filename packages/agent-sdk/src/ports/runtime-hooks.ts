// A hook as a runtime holds it for a folder.
export interface RuntimeHook {
  readonly command: string
  // `waits`: the runtime runs it only once the owner has approved it there. `off`: the owner turned it off there.
  readonly standing: 'runs' | 'waits' | 'off'
}

// What a runtime answers when it is asked for the hooks of a folder: the ones it holds, or why it could not say.
export interface RuntimeHooks {
  readonly hooks: readonly RuntimeHook[]
  readonly failure: string | null
}
