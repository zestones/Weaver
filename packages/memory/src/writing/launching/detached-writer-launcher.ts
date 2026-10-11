import { spawn } from 'node:child_process'
import { extname, join } from 'node:path'
import type { WriterJob } from '../request/writer-job.ts'
import type { WriterLauncher } from './writer-launcher.ts'

// The writer runs in a process of its own, which the end of the hook that started it does not stop: writing cards
// takes longer than an agent runtime lets a hook live.
export class DetachedWriterLauncher implements WriterLauncher {
  private readonly worker: string

  // The worker is a program of this package, built beside this file as it is written beside it.
  constructor(worker: string = join(import.meta.dirname, '../../bin', `card-writer-worker${extname(import.meta.filename)}`)) {
    this.worker = worker
  }

  start(job: WriterJob): void {
    const worker = spawn(process.execPath, [this.worker, JSON.stringify(job)], { detached: true, stdio: 'ignore' })

    // A writer that cannot start leaves the flags raw: the next one writes them up.
    worker.on('error', () => undefined)
    worker.unref()
  }
}
