export interface RunningProcess {
  readonly parent: number
  // What the system calls it, when it says so apart from the command line: a runtime may rename its process.
  readonly name: string | null
  readonly command: readonly string[]
}

export interface ProcessList {
  // null when the process is gone, or cannot be read.
  find(pid: number): RunningProcess | null
}
