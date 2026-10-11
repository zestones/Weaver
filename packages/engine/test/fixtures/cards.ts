import { CardRegistry, type Card, type CardState } from '@weaver/memory'
import type { Repository } from '../../src/lib/git/repository.ts'

const EVERY_STATE: readonly CardState[] = ['raw', 'open', 'closed', 'merged']

// A registry is opened for one look and closed again, as a hook does.
export function withRegistry<Result>(repo: Repository, work: (registry: CardRegistry) => Result): Result {
  const registry = new CardRegistry(repo.stateDir)

  try {
    return work(registry)
  } finally {
    registry.close()
  }
}

export const cardsOf = (repo: Repository): Card[] => withRegistry(repo, (registry) => registry.list({ states: EVERY_STATE }))

export const FLAG_BODY = [
  'Seen: no call of refresh() exists under src/.',
  'Expected: the token is refreshed before a request goes out.',
  'Found: I was looking for the callers of getToken for my task.',
  'Checked: grep over src/. I did not run the application.',
  'Did: left as it is.',
  '',
].join('\n')

export const flagCommand = (places: readonly string[], body: string = FLAG_BODY): string =>
  `${['weaver', 'flag', ...places].join(' ')} <<'EOF'\n${body}EOF`
