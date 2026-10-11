import type { WriterJob } from '../request/writer-job.ts'

// Starts a writer on the flags that wait, and comes back at once: the writer runs on its own.
export interface WriterLauncher {
  start(job: WriterJob): void
}
