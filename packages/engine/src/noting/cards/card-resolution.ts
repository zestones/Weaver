import { CardRegistry, type Card } from '@weaver/memory'
import type { Session } from '../../unit-of-work/session/session.ts'
import type { UnitOfWork } from '../../unit-of-work/unit/unit-of-work.ts'

export class CardResolution {
  private readonly session: Session
  private readonly limit: number | null

  constructor(session: Session, limit: number | null) {
    this.limit = limit
    this.session = session
  }

  prepare(unit: UnitOfWork, lastMessage: string | null): Card[] {
    const { session } = this
    if (!CardRegistry.isIn(session.repo.stateDir)) return []
    const registry = new CardRegistry(session.repo.stateDir)
    const holder = `${session.id}:${String(unit.number)}`
    try {
      if (unit.cards.resolutionAsked === true || unit.cards.asked.length > 0) {
        this.defer(registry, unit, lastMessage)
        registry.releaseResolution(holder)
        return []
      }
      if (this.limit === 0) return []
      const cards = registry
        .about(Object.keys(unit.files))
        .reverse()
        .filter((card) => {
          const by = card.record.provenance
          return (
            card.isWaiting &&
            card.origin !== 'suspicion' &&
            card.conclusion?.as !== 'fixed' &&
            card.conclusion?.as !== 'refuted' &&
            !unit.cards.noted.includes(card.number) &&
            !(unit.cards.flagged ?? []).includes(card.number) &&
            !(by.session === session.id && by.unit === unit.number)
          )
        })
      const resolving = registry.claimResolution(
        cards.filter((card) => card.decision.kind === 'none').map((card) => card.number),
        holder,
        this.limit,
      )
      const documenting = cards
        .filter((card) => card.decision.kind !== 'none')
        .slice(0, this.limit === null ? undefined : this.limit - resolving.length)
      const selected = [...resolving, ...documenting]
      if (selected.length === 0) return []
      if (
        !session.askNotes(
          selected.map((card) => card.number),
          resolving.map((card) => card.number),
        )
      )
        return []
      return selected
    } finally {
      registry.close()
    }
  }

  private defer(registry: CardRegistry, unit: UnitOfWork, lastMessage: string | null): void {
    for (const number of unit.cards.resolving ?? []) {
      const card = registry.find(number)
      if (
        card === null ||
        !card.isWaiting ||
        card.decision.kind === 'owner' ||
        ['fixed', 'refuted', 'deferred'].includes(card.conclusion?.as ?? '')
      )
        continue
      registry.note(number, {
        conclusion: 'deferred',
        text: `Deferred after the resolution pass. ${lastMessage?.trim() || 'No final explanation was supplied.'}`,
        provenance: {
          author: this.session.agent,
          role: 'author',
          session: this.session.id,
          subagent: null,
          unit: unit.number,
          requests: unit.requests,
          commit: this.session.repo.head(),
          at: new Date().toISOString(),
        },
      })
    }
  }
}
