import { PlaceText, type Card, type CardRegistry } from '@weaver/memory'

export class IssueBody {
  private readonly registry: CardRegistry | null

  constructor(registry: CardRegistry | null = null) {
    this.registry = registry
  }

  text(card: Card, reason: string | null): string {
    const { written, flag, review, notes, ties, occurrences, proposal } = card.record
    const related = [...new Set([...ties, ...occurrences.flatMap((entry) => (entry.card === null ? [] : [entry.card]))])]
    const body = [
      '## Problem',
      card.title,
      ...(card.places.length === 0 ? [] : [`Locations: ${card.places.map((place) => PlaceText.write(place)).join(', ')}`]),
      ...(written?.sections.map((section) => `### ${section.name}\n\n${section.text}`) ?? []),
      ...(flag === null ? [] : [flag.fields.seen, `Expected: ${flag.fields.expected}`, `Found: ${flag.fields.found}`]),
      ...(review === null ? [] : [review.message, review.quote ?? '', review.suggestion ?? '']),
      '## Evidence',
      ...(flag === null
        ? []
        : [flag.fields.checked, ...flag.context.map((context) => `${PlaceText.write(context.place)}:\n\n${context.excerpt}`)]),
      review?.evidence ?? '',
      ...notes.map((note) => `${note.provenance.author} (${note.conclusion ?? 'note'}):\n\n${note.text}`),
      ...occurrences.map((entry) => entry.note),
      ...(related.length === 0 ? [] : ['## Related problems', ...related.map((number) => this.substance(number))]),
      '## Proposed disposition',
      reason ?? proposal?.reason ?? 'Track this problem as an issue.',
    ]
      .filter((part) => part !== '')
      .join('\n\n')
    return this.clean(body)
  }

  private substance(number: number): string {
    const card = this.registry?.find(number)
    if (card == null) return 'Related problem (details unavailable)'
    return [
      card.title,
      ...(card.record.written?.sections.map((section) => section.text) ?? []),
      card.record.review?.message ?? card.record.flag?.fields.seen ?? '',
    ].join(' — ')
  }

  private reference(number: number, expanded: ReadonlySet<number>): string {
    return expanded.has(number) ? 'related problem' : this.clean(this.substance(number), new Set([...expanded, number]))
  }

  private clean(text: string, expanded: ReadonlySet<number> = new Set()): string {
    // URLs remain explicit, including genuine issue links and line anchors.
    return text
      .split(/(https?:\/\/[^\s<>]+)/g)
      .map((part) => {
        if (/^https?:\/\//.test(part)) return part
        const commands = part
          .replace(
            /\bweaver\s+cards\s+(?:tie|untie)\s+(\d+)\s+(\d+)/gi,
            (_match, left: string, right: string) =>
              `${this.reference(Number(left), expanded)}; ${this.reference(Number(right), expanded)}`,
          )
          .replace(
            /\bweaver\s+(?:close|note|cards(?:\s+(?:reopen|retitle|label|rewrite|separate|restore|revisions|issue-result))?)\s+(\d+)/gi,
            (_match, number: string) => this.reference(Number(number), expanded),
          )
        return commands.replace(
          /\bcards?\s*:?\s*(#?\d+(?:(?:\s*,\s*|\s+(?:and|or)\s+)#?\d+)*)\b|#(\d+)\b/gi,
          (_match, cards: string | undefined, bare: string | undefined) =>
            ((cards ?? bare ?? '').match(/\d+/g) ?? []).map((number) => this.reference(Number(number), expanded)).join('; '),
        )
      })
      .join('')
  }
}
