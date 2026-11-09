import { CardRegistry, type Card } from '@weaver/memory'
import type { Repository } from '../../lib/git/repository.ts'

// The cards that wait for the owner and that an agent may still settle: open, and not concluded fixed already. A
// suspicion is the owner's alone: no agent reads it.
export class WaitingCards {
  private readonly repo: Repository

  constructor(repo: Repository) {
    this.repo = repo
  }

  // Those that name one of these files, oldest first.
  naming(paths: readonly string[]): Card[] {
    return this.read((registry) => registry.about(paths).reverse())
  }

  // A project with no card has no registry yet, and looking makes none.
  private read(cards: (registry: CardRegistry) => Card[]): Card[] {
    if (!CardRegistry.isIn(this.repo.stateDir)) return []

    const registry = new CardRegistry(this.repo.stateDir)

    try {
      return cards(registry).filter(
        (card) => card.isWaiting && card.origin !== 'suspicion' && card.conclusion?.as !== 'fixed' && card.conclusion?.as !== 'refuted',
      )
    } finally {
      registry.close()
    }
  }
}
