import { spawn } from 'node:child_process'
import { dirname, extname, join } from 'node:path'
import type { Repository } from '../../lib/git/repository.ts'
import type { ReviewLauncher } from './review-launcher.ts'

// Started by a process that leaves at once, the worker is no descendant of the hook: a runtime that cancels a hook
// ends all its descendants, even those in a group of their own.
const LAUNCH = "require('node:child_process').spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: 'ignore' }).unref()"

// The review runs in a process of its own, which outlives the hook that started it: a review may take longer than an
// agent runtime lets a hook live, and the owner may take the turn back while it runs.
export class DetachedLauncher implements ReviewLauncher {
  private readonly worker: string

  // The worker is the program beside the hook that is running.
  constructor(hook: string = process.argv[1] ?? '') {
    this.worker = join(dirname(hook), `review-worker${extname(hook)}`)
  }

  start(repo: Repository, sessionDir: string, content: string): void {
    spawn(process.execPath, ['-e', LAUNCH, this.worker, repo.top, sessionDir, content], { detached: true, stdio: 'ignore' }).unref()
  }
}
