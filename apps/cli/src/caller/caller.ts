// Who runs a command of Weaver.
export interface Caller {
  // The agent runtime the command runs under, `claude` or `codex`; null from a terminal of the owner's.
  agent(): string | null
}
