import { spawn } from 'node:child_process'
import { dirname, extname, join } from 'node:path'
import type { Repository } from '../../lib/git/repository.ts'
import type { ReviewLauncher } from './review-launcher.ts'

// The review runs in a process of its own, which the end of the hook that started it does not stop: a review may
// take longer than an agent runtime lets a hook live.
export class DetachedLauncher implements ReviewLauncher {
  private readonly worker: string

  // The worker is the program beside the hook that is running.
  constructor(hook: string = process.argv[1] ?? '') {
    this.worker = join(dirname(hook), `review-worker${extname(hook)}`)
  }

  start(repo: Repository, sessionDir: string, content: string): void {
    spawn(process.execPath, [this.worker, repo.top, sessionDir, content], { detached: true, stdio: 'ignore' }).unref()
  }
}
