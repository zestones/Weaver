import type { Place } from '../flags/flag-record.ts'
import { PlaceText } from '../flags/place-text.ts'
import { clip } from '../lib/text/clip.ts'
import { CardMarkdown } from './card-markdown.ts'
import type { CardOrigin, CardRecord, CardState } from './card-record.ts'

const TITLE_LIMIT = 80

export class Card {
  readonly record: CardRecord

  constructor(record: CardRecord) {
    this.record = record
  }

  get number(): number {
    return this.record.number
  }

  get state(): CardState {
    return this.record.state
  }

  get origin(): CardOrigin {
    return this.record.origin
  }

  // A card nobody wrote up is named after what it holds: what the agent saw, or what the review said.
  get title(): string {
    const { written, flag, review } = this.record

    return written?.title ?? clip(flag?.fields.seen ?? review?.message ?? '', TITLE_LIMIT)
  }

  get places(): readonly Place[] {
    return this.record.places
  }

  get isWaiting(): boolean {
    return this.state === 'raw' || this.state === 'open'
  }

  oneLine(): string {
    const [first, ...others] = this.places
    const place = first === undefined ? [] : [`${PlaceText.write(first)}${others.length === 0 ? '' : ` +${String(others.length)}`}`]

    return [`#${String(this.number)} ${this.standing}`, ...place, this.title].join('  ')
  }

  markdown(): string {
    return new CardMarkdown(this).text()
  }

  // The labels as `family:value`, for a command that files an issue.
  labels(): string[] {
    return Object.entries(this.record.written?.labels ?? {}).flatMap(([family, values]) => values.map((value) => `${family}:${value}`))
  }

  // The places whose flagged line is no longer in its file. `read` gives the text of a file, or null when it is gone.
  // A line that only moved still reads as it did: lines come and go above it all the time.
  changedPlaces(read: (file: string) => string | null): Place[] {
    return this.flaggedLines().flatMap(([place, text]) => {
      const now = read(place.file)
      const kept = now !== null && now.split('\n').some((line) => line.trim() === text.trim())

      return kept ? [] : [place]
    })
  }

  // How it stands, in a word or two: its state, how it was closed, or the card it was merged into.
  get standing(): string {
    const { state, closing, mergedInto, seenSinceClosing } = this.record

    if (state === 'merged') return `merged into #${String(mergedInto)}`
    if (state !== 'closed' || closing === null) return state

    return `closed (${closing.as}${seenSinceClosing ? ', seen again' : ''})`
  }

  // A flag keeps the text of each line it names; a review keeps the one line its reviewer quoted.
  private flaggedLines(): (readonly [Place, string])[] {
    const { flag, review, places } = this.record
    const quote = review?.quote ?? null

    if (flag !== null) return flag.context.flatMap(({ place, lineText }) => (lineText === null ? [] : [[place, lineText] as const]))
    if (quote === null || quote.trim().includes('\n')) return []

    return places.flatMap((place) => (place.line === null ? [] : [[place, quote] as const]))
  }
}
