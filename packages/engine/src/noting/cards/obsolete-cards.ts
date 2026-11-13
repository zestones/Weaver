import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CardRegistry, Provenance } from '@weaver/memory'
import type { Repository } from '../../lib/git/repository.ts'

export class ObsoleteCards {
  private readonly repo: Repository

  constructor(repo: Repository) {
    this.repo = repo
  }

  draft(registry: CardRegistry, by: Provenance): void {
    const head = this.repo.head()
    if (head === null) return
    const cards = registry
      .list()
      .filter((card) => card.isWaiting && card.record.proposal === null && card.decision.kind !== 'owner' && card.places.length > 0)
    const paths = [...new Set(cards.flatMap((card) => card.places.map((place) => place.file)))]
    const present = this.repo.treeEntries(head, paths)
    for (const card of cards) {
      const files = [...new Set(card.places.map((place) => place.file))]
      if (files.some((file) => present.has(file) || existsSync(join(this.repo.top, file)))) continue
      // A path never committed may be a typo or new work, rather than deleted code.
      if (this.repo.git(['log', '-1', '--format=%H', head, '--', ...files]) === '') continue
      registry.note(card.number, {
        conclusion: 'refuted',
        text: `Ran: checked every referenced file at HEAD ${head}.\nRead: ${files.join(', ')}.\nShows: All referenced files were deleted; the code this card concerns no longer exists at HEAD.`,
        provenance: { ...by, commit: head },
      })
    }
  }
}
