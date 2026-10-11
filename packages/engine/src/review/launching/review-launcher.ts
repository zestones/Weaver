import type { Repository } from '../../lib/git/repository.ts'

// Starts the review that the store holds under this content, and comes back at once: the review runs on its own.
export interface ReviewLauncher {
  start(repo: Repository, sessionDir: string, content: string): void
}
