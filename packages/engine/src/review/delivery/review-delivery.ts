import { CardRegistry, type Card, type Provenance } from '@weaver/memory'
import type { Repository } from '../../lib/git/repository.ts'
import type { ReviewRecord } from '../results/review-record.ts'
import { ReviewOutcome } from '../results/review-outcome.ts'
import { UnitReview } from '../rounds/unit-review.ts'

export class ReviewDelivery {
  private readonly repo: Repository

  constructor(repo: Repository) {
    this.repo = repo
  }

  taken(session: string, content: string): void {
    this.using((registry) => registry.publishReview(JSON.stringify([session, content, 'taken']), session, []))
  }

  finished(session: string, content: string, record: ReviewRecord): void {
    if (record.state !== 'reviewed' || record.outcome === null) return
    const origin = record.origin ?? {
      author: record.outcome.runtime,
      role: 'reviewer',
      session,
      subagent: null,
      unit: null,
      requests: record.request.requests,
      commit: record.head,
      at: record.startedAt,
    }
    const review = new UnitReview({
      standing: record.answers.length > 0 ? 'answered' : 'for-owner',
      answers: record.answers,
      content,
      outcome: new ReviewOutcome(record.outcome),
      round: record.round ?? 0,
      maxRefusals: record.maxRefusals ?? 0,
    })
    this.publish(review, origin, record.request.rules, true)
  }

  publish(review: UnitReview, origin: Provenance, rules: readonly { id: string; statement: string }[], unattended = false): Card[] {
    const session = origin.session ?? ''
    const points = review.points().map(({ origin: kind, place, content }) => ({
      identity: JSON.stringify([session, review.content, kind, content.review.split('/').at(-1)]),
      legacyPoint: JSON.stringify([content.review, content.message]),
      origin: kind,
      places: place === null ? [] : [place],
      content: { ...content, statement: rules.find((rule) => rule.id === content.rule)?.statement ?? null },
      provenance: { ...origin, author: review.outcome.runtime },
    }))
    return this.using((registry) =>
      registry.publishReview(
        JSON.stringify([session, review.content, 'cards']),
        session,
        points,
        unattended ? JSON.stringify([session, review.content, 'taken']) : undefined,
      ),
    )
  }

  notice(session: string, files: readonly string[] = []): string | null {
    const cards = this.using((registry) => registry.reviewNotices(session, files))
    return cards.length === 0
      ? null
      : `[weaver] These review findings were filed as cards: ${cards.map((card) => card.oneLine()).join('; ')}. Read them with weaver cards <number>.`
  }

  private using<T>(work: (registry: CardRegistry) => T): T {
    const registry = new CardRegistry(this.repo.stateDir)
    try {
      return work(registry)
    } finally {
      registry.close()
    }
  }
}
