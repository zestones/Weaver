import type { PlaceContext } from '../flags/flag-record.ts'
import { PlaceText } from '../flags/place-text.ts'
import { clip, oneLine } from '../lib/text/clip.ts'
import { fenced } from '../lib/text/fence.ts'
import type { CardNote, CardRecord, Occurrence, Provenance, ReviewContent, WriterLook } from './card-record.ts'
import type { Card } from './card.ts'

const REQUEST_LIMIT = 300
const SAW: Readonly<Record<WriterLook['verdict'], string>> = {
  agrees: 'what it read agrees with the flag',
  contradicts: 'what it read contradicts the flag',
  'cannot-tell': 'what it read does not let it tell',
}
const LINES: Readonly<Record<PlaceContext['origin'], string>> = {
  before: ', lines that were there before the unit of work',
  unit: ', lines that the unit of work wrote',
  unknown: '',
}

// A card as its owner reads it in a terminal, and as the body of the issue it may become.
export class CardMarkdown {
  private readonly card: Card
  private readonly record: CardRecord

  constructor(card: Card) {
    this.card = card
    this.record = card.record
  }

  text(): string {
    return [
      `# ${this.card.title}`,
      this.header().join('\n'),
      ...this.body(),
      ...this.flag(),
      ...this.notes(),
      ...this.occurrences(),
      ...this.ties(),
      ...this.closing(),
    ].join('\n\n')
  }

  private header(): string[] {
    const { number, origin, places, provenance } = this.record
    const { session, unit, commit, at } = provenance
    const labels = this.card.labels()

    return [
      `- Card: #${String(number)}`,
      `- Origin: ${origin}`,
      `- State: ${this.state()}`,
      `- Labels: ${labels.length === 0 ? 'none' : labels.join(', ')}`,
      `- Places: ${places.length === 0 ? 'none' : places.map((place) => `\`${PlaceText.write(place)}\``).join(', ')}`,
      `- Author: ${this.author(provenance)}`,
      `- Session: ${session === null ? 'none' : `\`${session}\``}${unit === null ? '' : `, unit ${String(unit)}`}`,
      ...this.asked(provenance.requests),
      `- Date: ${at}${commit === null ? '' : `, at commit \`${commit}\``}`,
      ...this.look(),
      ...this.concluded(),
    ]
  }

  private state(): string {
    const { state, closing, mergedInto } = this.record

    if (state === 'merged') return `merged into #${String(mergedInto)}`
    if (state === 'closed' && closing !== null) return `closed as ${closing.as}`

    return state === 'raw' ? 'raw, not written up yet' : state
  }

  private author({ author, role, subagent }: Provenance): string {
    const who = role === 'owner' ? 'the owner' : `${author}, as ${role}`

    return subagent === null ? who : `${who}, subagent \`${subagent}\``
  }

  private asked(requests: readonly string[]): string[] {
    const [first, ...others] = requests.map((request) => clip(request, REQUEST_LIMIT))

    if (first === undefined) return ['- Asked by the owner: nothing recorded']
    if (others.length === 0) return [`- Asked by the owner: ${first}`]

    return ['- Asked by the owner:', ...[first, ...others].map((request, index) => `  ${String(index + 1)}. ${request}`)]
  }

  // A card that comes from a review was never the writer's to look at.
  private look(): string[] {
    const { flag, written, writing } = this.record

    if (written !== null) return [`- What the writer saw: ${SAW[written.look.verdict]}. ${oneLine(written.look.note)}`.trimEnd()]
    if (flag === null) return []

    return [
      writing.failure === null
        ? '- What the writer saw: nothing yet'
        : `- What the writer saw: nothing, after ${String(writing.attempts)} failed attempts: ${oneLine(writing.failure)}`,
    ]
  }

  private concluded(): string[] {
    const concluded = this.card.conclusion

    return concluded === null ? [] : [`- Concluded: ${concluded.as}, by ${this.author(concluded.by)}, on ${concluded.by.at}`]
  }

  private body(): string[] {
    const { review, written } = this.record

    if (review !== null) return this.review(review)

    return (written?.sections ?? []).map(({ name, text }) => `## ${name}\n\n${text.trim()}`)
  }

  private review(content: ReviewContent): string[] {
    const { review, rule, statement, message, quote, suggestion, evidence, standing } = content
    const ruled = rule === null ? [] : [`- Rule: ${rule}${statement === null ? '' : `: ${oneLine(statement)}`}`]

    return [
      `## ${this.record.origin === 'suspicion' ? 'Suspicion' : 'Finding'}`,
      message.trim(),
      [`- Review: \`${review}\``, ...ruled, `- Why it waits for the owner: ${oneLine(standing)}`].join('\n'),
      ...(quote === null ? [] : ['### The line as the reviewer read it', fenced(quote, 'text')]),
      ...(suggestion === null ? [] : ['### Suggestion', suggestion.trim()]),
      ...(evidence === null ? [] : ['### Evidence', evidence.trim()]),
    ]
  }

  private flag(): string[] {
    const { flag } = this.record

    return flag === null ? [] : ['## Flag', fenced(flag.text, 'text'), ...flag.context.flatMap((context) => this.kept(context))]
  }

  private kept({ place, exists, excerpt, origin }: PlaceContext): string[] {
    const name = `\`${PlaceText.write(place)}\``

    if (!exists) return [`${name} was not there when it was flagged.`]

    return excerpt === '' ? [] : [`${name} when it was flagged${LINES[origin]}:`, fenced(excerpt, 'text')]
  }

  private notes(): string[] {
    const { notes } = this.record

    return notes.length === 0 ? [] : ['## Notes', ...notes.flatMap((note) => this.note(note))]
  }

  private note({ provenance, conclusion, text }: CardNote): string[] {
    return [`### ${provenance.at}, ${this.author(provenance)}${conclusion === null ? '' : `: ${conclusion}`}`, text.trim()]
  }

  private occurrences(): string[] {
    const { occurrences } = this.record

    return occurrences.length === 0 ? [] : ['## Occurrences', occurrences.map((occurrence) => this.occurrence(occurrence)).join('\n')]
  }

  private occurrence({ card, provenance, note }: Occurrence): string {
    return `- ${provenance.at}, ${this.author(provenance)}${card === null ? '' : `, as card #${String(card)}`}: ${oneLine(note)}`
  }

  private ties(): string[] {
    const { ties } = this.record

    return ties.length === 0 ? [] : ['## Ties', `May be the same thing as ${ties.map((tie) => `#${String(tie)}`).join(', ')}.`]
  }

  private closing(): string[] {
    const { closing, seenSinceClosing } = this.record

    if (closing === null) return []

    return [
      '## Closing',
      `Closed as ${closing.as} on ${closing.at}${closing.reason === null ? '.' : `: ${closing.reason.trim()}`}`,
      ...(closing.issue === null ? [] : [`Issue: ${closing.issue.trim()}`]),
      ...(seenSinceClosing ? ['Seen again since it was closed.'] : []),
    ]
  }
}
