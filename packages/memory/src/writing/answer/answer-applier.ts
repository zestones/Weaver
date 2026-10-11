import type { WrittenCard } from '../../cards/card-record.ts'
import type { CardRegistry } from '../../registry/card-registry.ts'
import { RegistryError } from '../../registry/registry-error.ts'
import type { FlagAnswer } from './answer-reader.ts'

const SAME = 'the writer read them as the same thing'

export class AnswerApplier {
  private readonly registry: CardRegistry
  private readonly writer: WrittenCard['writer']

  constructor(registry: CardRegistry, writer: WrittenCard['writer']) {
    this.registry = registry
    this.writer = writer
  }

  // A flag without a card stays raw, with the reason.
  apply(flag: number, answer: FlagAnswer | string): void {
    if (typeof answer === 'string') {
      this.registry.writingFailed(flag, answer)

      return
    }

    const { title, labels, sections, look } = answer

    try {
      this.registry.written(flag, { title, labels, sections, look, writer: this.writer, at: new Date().toISOString() })
    } catch (error) {
      this.registry.writingFailed(flag, error instanceof Error ? error.message : String(error))

      return
    }

    this.join(flag, answer)
  }

  // Sure, the flag becomes an occurrence of the other card, and keeps what was written of it: taken apart later, it
  // is a card and is not written up again. Not sure, they stay two cards, tied. A card that can be neither merged
  // nor tied is written all the same.
  private join(flag: number, { sameAs, sure, sameNote }: FlagAnswer): void {
    const other = sameAs === null ? null : this.standing(sameAs)

    if (other === null || other === flag) return

    try {
      if (sure) this.registry.merge(flag, other, sameNote ?? SAME)
      else this.registry.tie(flag, other, sameNote ?? SAME)
    } catch (error) {
      if (!(error instanceof RegistryError)) throw error
    }
  }

  // The card a merged one lives on in.
  private standing(number: number): number | null {
    let card = this.registry.find(number)

    while (card !== null && card.record.mergedInto !== null) card = this.registry.find(card.record.mergedInto)

    return card?.number ?? null
  }
}
