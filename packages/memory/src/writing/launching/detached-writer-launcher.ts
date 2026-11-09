import { CardRegistry } from '../../registry/card-registry.ts'
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
    const registry = new CardRegistry(job.stateDir)
    let flags: { number: number; attempts: number }[]
    try {
      flags = registry
        .awaitingWriter(2)
        .slice(0, 5)
        .map((flag) => ({ number: flag.number, attempts: flag.record.writing.attempts }))
    } finally {
      registry.close()
    }
    let reported = false
    const failed = (failure: string): void => {
      if (reported) return
      reported = true
      this.failed(job, flags, failure)
    }
    const worker = spawn(process.execPath, [this.worker, JSON.stringify(job)], { detached: true, stdio: 'ignore' })

    worker.on('error', (error) => failed(`The writer could not start: ${error.message}`))
    worker.on('exit', (code, signal) => {
      if (code !== 0) failed(`The writer stopped: ${signal ?? String(code)}`)
    })
    worker.unref()
  }

  private failed(job: WriterJob, flags: readonly { number: number; attempts: number }[], failure: string): void {
    let registry: CardRegistry | null = null
    try {
      registry = new CardRegistry(job.stateDir)
      for (const { number, attempts } of flags) {
        const flag = registry.find(number)
        if (flag?.state === 'raw' && flag.record.writing.attempts === attempts) registry.writingFailed(number, failure)
      }
    } catch {
      // The next hook reports a registry that can no longer be opened.
    } finally {
      registry?.close()
    }
  }
}
