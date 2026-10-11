import { CardRegistry, type Card, type Provenance } from '@weaver/memory'
import type { Declaration } from '../../declaration/content/declaration.ts'
import type { Repository } from '../../lib/git/repository.ts'
import type { Session } from '../../unit-of-work/session/session.ts'
import type { UnitOfWork } from '../../unit-of-work/unit/unit-of-work.ts'
import type { UnitReview } from '../rounds/unit-review.ts'

// A reviewer reads this many cards at most, the newest.
const TOLD_LIMIT = 40

// The cards of a repository as its reviews use them: what a review leaves for the owner goes in, and what the cards
// say of a file is told to its next reviewer.
export class ReviewCards {
  private readonly repo: Repository

  constructor(repo: Repository) {
    this.repo = repo
  }

  // A point that an earlier review already left at the same place comes back as the card it has, with one occurrence
  // more: the registry tells them apart.
  open(review: UnitReview, session: Session, unit: UnitOfWork, declaration: Declaration): Card[] {
    const points = review.points()

    if (points.length === 0) return []

    const provenance: Provenance = {
      author: review.outcome.runtime,
      role: 'reviewer',
      session: session.id,
      subagent: null,
      unit: unit.number,
      requests: unit.requests,
      commit: this.repo.head(),
      at: new Date().toISOString(),
    }

    return this.reading((registry) =>
      points.map(({ origin, place, content }) => {
        const statement = content.rule === null ? '' : declaration.statementOf(content.rule)

        return registry.open({
          origin,
          places: place === null ? [] : [place],
          content: { ...content, statement: statement === '' ? null : statement },
          provenance,
        })
      }),
    )
  }

  // One line a card, with how it was closed and why.
  about(paths: readonly string[]): string[] {
    if (paths.length === 0) return []

    return this.reading((registry) =>
      registry
        .about(paths)
        .slice(0, TOLD_LIMIT)
        .map((card) => this.line(card)),
    )
  }

  private line(card: Card): string {
    const { review, closing } = card.record
    const reason = closing?.reason ?? null
    const notes = [
      ...(review === null ? [] : [...(review.rule === null ? [] : [`rule ${review.rule}`]), review.standing]),
      ...(reason === null ? [] : [`the owner's reason: ${reason}`]),
    ]

    return notes.length === 0 ? card.oneLine() : `${card.oneLine()} (${notes.join('; ').replace(/\s+/g, ' ')})`
  }

  private reading<Result>(work: (registry: CardRegistry) => Result): Result {
    const registry = new CardRegistry(this.repo.stateDir)

    try {
      return work(registry)
    } finally {
      registry.close()
    }
  }
}
