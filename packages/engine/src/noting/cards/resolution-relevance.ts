import type { Card, CardRegistry } from '@weaver/memory'
import type { Repository } from '../../lib/git/repository.ts'

export class ResolutionRelevance {
  private readonly repo: Repository

  constructor(repo: Repository) {
    this.repo = repo
  }

  changed(card: Card, registry: CardRegistry): boolean {
    const notes = card.record.notes.slice(card.record.lifecycle?.noteStart ?? 0)
    if (card.decision.kind === 'owner') {
      if (registry.ownerQuestionAsked(card)) return false
      if (notes.some((note) => note.conclusion === 'needs-owner' && note.text === card.decision.question)) return false
      const askedAt = card.record.flag?.fields.decision?.kind === 'owner' ? card.record.provenance.at : card.record.written?.at
      return askedAt === undefined || !notes.some((note) => note.provenance.at >= askedAt)
    }
    if (card.conclusion?.as !== 'deferred') return true
    const last = card.record.history.findLastIndex((event) => event.action === 'noted' && event.note === 'deferred')
    if (last >= 0 && last < card.record.history.length - 1) return true
    const note = notes.findLast((note) => note.conclusion === 'deferred')
    if (note === undefined) return true
    const paths = card.places.map((place) => place.file)
    try {
      const before =
        note.fileBlobs === undefined
          ? note.provenance.commit === null
            ? null
            : this.repo.blobsAt(note.provenance.commit, paths)
          : new Map(Object.entries(note.fileBlobs))
      if (before === null) return false
      const now = this.repo.hashPaths(paths)
      return paths.some((path) => !before.has(path) || !now.has(path) || before.get(path) !== now.get(path))
    } catch {
      return false
    }
  }
}
