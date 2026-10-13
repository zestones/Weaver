import { Card, NoteText, PlaceText, type CardRecord, type PlaceContext, type Provenance } from '@weaver/memory'
import type { Atom } from '../markdown/atom.ts'
import { DrawnCode, type NumberedLine } from '../markdown/drawn-code.ts'
import { InlineMarkdown } from '../markdown/inline-markdown.ts'
import { TerminalMarkdown } from '../markdown/terminal-markdown.ts'
import { WrappedLines } from '../markdown/wrapped-lines.ts'
import { LocalMoment } from '../output/local-moment.ts'
import type { Paint } from '../output/paint.ts'

const INDENT = '  '
// Every name of the page is as wide as the longest of them, `Expected`: what they say starts in one column all the
// way down.
const NAME_WIDTH = 8
const SAID_AT = INDENT.length + NAME_WIDTH + INDENT.length
const CUT = '…'
// A commit is named as git names it in a list: by the start of its hash.
const HASH_LENGTH = 12
const FOUND: Readonly<Record<CardRecord['origin'], string>> = {
  flag: 'flagged',
  owner: 'flagged',
  finding: 'found',
  suspicion: 'suspected',
}
const DID = { left: 'left as it is', 'worked-around': 'worked around', fixed: 'fixed in the task' } as const
const LOOK = { agrees: 'agrees with the flag', contradicts: 'contradicts the flag', 'cannot-tell': 'could not tell' } as const
const WRITTEN: Readonly<Record<PlaceContext['origin'], string>> = {
  before: ', lines from before the unit of work',
  unit: ', lines the unit of work wrote',
  unknown: '',
}

// A card as its owner reads it at a terminal. It is drawn from what the card holds, not from its Markdown: what it is
// and where it stands come first, what was written about it next, where it comes from last. Only what someone wrote
// as Markdown, the sections of the writer and the words of a review, is read as Markdown.
export class CardPage {
  private readonly card: Card
  private readonly record: CardRecord
  private readonly paint: Paint
  private readonly width: number
  private readonly markdown: TerminalMarkdown
  private readonly inline: InlineMarkdown
  private readonly wrapped: WrappedLines
  private readonly code: DrawnCode

  constructor(card: Card, paint: Paint, width: number) {
    this.card = card
    this.record = card.record
    this.paint = paint
    this.markdown = new TerminalMarkdown(paint, width)
    this.width = this.markdown.width
    this.inline = new InlineMarkdown(paint)
    this.wrapped = new WrappedLines(this.width)
    this.code = new DrawnCode(paint, Math.max(width, this.width))
  }

  lines(): string[] {
    const parts = [
      this.head(),
      ...this.body(),
      this.flag(),
      this.notes(),
      this.occurrences(),
      this.ties(),
      this.closing(),
      this.source(),
      this.next(),
    ]

    return parts.filter((part) => part.length > 0).flatMap((part, index) => (index === 0 ? part : ['', ...part]))
  }

  // What the card says, how it stands, and where it is.
  private head(): string[] {
    const { number, origin, places, provenance } = this.record
    const labels = this.card.labels()
    const facts = [
      this.paint.bold(`#${String(number)}`),
      this.standing(),
      `${FOUND[origin]} by ${this.author(provenance)}`,
      new LocalMoment(provenance.at).text,
      ...(labels.length === 0 ? [] : [labels.join(', ')]),
    ]

    return [
      ...this.wrapped.of(this.inline.typed(this.card.title, (word) => this.paint.bold(word))),
      ...this.stated(facts),
      ...this.alerts(),
      ...(places.length === 0 ? [] : ['', ...places.map((place) => `${INDENT}${this.paint.cyan(PlaceText.write(place))}`)]),
    ]
  }

  private standing(): string {
    const { state } = this.record
    const concluded = this.card.conclusion

    if (state === 'open') return this.paint.green(this.card.standing)
    if (state !== 'raw') return this.paint.dim(this.card.standing)

    return this.paint.yellow(`raw, not written up yet${concluded === null ? '' : ` (${concluded.as})`}`)
  }

  // Facts on one line, set apart by a mark. A fact is never cut by the end of a line, and its mark stays with it.
  private stated(facts: readonly string[]): string[] {
    return this.wrapped.of(
      facts.map((fact, index): Atom => {
        const text = index === facts.length - 1 ? fact : `${fact} ${this.paint.dim('·')}`

        return { text, width: this.wrapped.visible(text) }
      }),
    )
  }

  // What the owner should know before reading on: the writer disagrees, the writing failed, the thing came back.
  private alerts(): string[] {
    const { written, writing, seenSinceClosing } = this.record
    const alerts = [
      ...(written?.look.verdict === 'contradicts' ? ['What the writer read contradicts the flag: see Writer, below.'] : []),
      ...(writing.failure === null ? [] : [`Writing it up failed, ${String(writing.attempts)} times: ${writing.failure}`]),
      ...(seenSinceClosing ? ['Seen again since it was closed.'] : []),
    ]

    return alerts.flatMap((alert) => this.wrapped.of(this.inline.typed(alert), `${this.paint.yellow('!')} `, INDENT))
  }

  private body(): string[][] {
    const { review, written, origin, places } = this.record

    if (review === null) return (written?.sections ?? []).map(({ name, text }) => this.markdown.lines(`## ${name}\n\n${text.trim()}`))

    const { message, rule, statement, standing, quote, suggestion, evidence } = review

    return [
      [
        ...this.titled(origin === 'suspicion' ? 'Suspicion' : 'Finding'),
        '',
        ...this.markdown.lines(message.trim()),
        '',
        ...this.named('Review', this.inline.typed(review.review)),
        ...(rule === null ? [] : this.named('Rule', this.inline.typed(statement === null ? rule : `${rule}: ${statement}`))),
        ...this.named('Waits', this.inline.typed(standing)),
      ],
      ...(quote === null
        ? []
        : [[this.paint.bold('The line as the reviewer read it'), ...this.code.block(quote, DrawnCode.languageOf(places[0]?.file ?? ''))]]),
      ...(suggestion === null ? [] : [this.markdown.lines(`### Suggestion\n\n${suggestion.trim()}`)]),
      ...(evidence === null ? [] : [this.markdown.lines(`### Evidence\n\n${evidence.trim()}`)]),
    ]
  }

  // The five things a flag says, each under its name, then the lines it pointed at, as they were.
  private flag(): string[] {
    const { flag } = this.record

    if (flag === null) return []

    const { seen, expected, found, checked, did, didNote } = flag.fields

    return [
      ...this.titled('Flag'),
      '',
      ...this.named('Seen', this.inline.typed(seen)),
      ...this.named('Expected', this.inline.typed(expected)),
      ...this.named('Found', this.inline.typed(found)),
      ...this.named('Checked', this.inline.typed(checked)),
      ...this.named('Did', this.inline.typed(didNote === null ? DID[did] : `${DID[did]}: ${didNote}`)),
      ...flag.context.flatMap((context) => this.kept(context)),
    ]
  }

  private kept({ place, exists, excerpt, origin }: PlaceContext): string[] {
    const where = this.inline.typed(PlaceText.write(place), (word) => this.paint.cyan(word))

    if (!exists) return ['', ...this.wrapped.of([...where, ...this.inline.typed('was not there when it was flagged.')], INDENT)]
    if (excerpt === '') return []

    // An excerpt is kept as text: each line after its number and two spaces.
    const lines = excerpt.split('\n').flatMap((line): NumberedLine[] => {
      const [, number, text = ''] = /^\s*(\d+) {2}(.*)$/.exec(line) ?? []

      return number === undefined ? [] : [{ number: Number(number), text }]
    })
    const language = DrawnCode.languageOf(place.file)

    return [
      '',
      ...this.wrapped.of([...where, ...this.dimmed(`as it was when flagged${WRITTEN[origin]}`)], INDENT),
      ...(lines.length === 0 ? this.code.block(excerpt, language) : this.code.excerpt(lines, language, place.line)),
    ]
  }

  // What was written on the card since it was made, in order: who, when and what they conclude, then what they say.
  private notes(): string[] {
    const notes = this.record.notes.flatMap(({ provenance, conclusion, text }) => [
      '',
      ...this.stated([
        this.paint.bold(this.author(provenance)),
        this.paint.dim(new LocalMoment(provenance.at).text),
        ...(conclusion === null ? [] : [conclusion]),
      ]),
      '',
      ...this.markdown.typed(text),
    ])

    return notes.length === 0 ? [] : [...this.titled('Notes'), ...notes]
  }

  private occurrences(): string[] {
    const lines = this.record.occurrences.flatMap(({ card, provenance, note }) => {
      const whose = `${new LocalMoment(provenance.at).text}, ${this.author(provenance)}${card === null ? '' : `, as card #${String(card)}`}:`

      return this.wrapped.of([...this.dimmed(whose), ...this.inline.typed(note)], `${INDENT}${this.paint.dim('•')} `, INDENT.repeat(2))
    })

    return lines.length === 0 ? [] : [...this.titled('Occurrences'), '', ...lines]
  }

  private ties(): string[] {
    const { ties } = this.record

    return ties.length === 0
      ? []
      : [...this.titled('Ties'), '', `May be the same thing as ${ties.map((tie) => `#${String(tie)}`).join(', ')}.`]
  }

  private closing(): string[] {
    const { closing } = this.record

    if (closing === null) return []

    return [
      ...this.titled('Closing'),
      '',
      ...this.named('As', this.inline.typed(closing.as)),
      ...this.named('On', this.inline.typed(new LocalMoment(closing.at).text)),
      ...(closing.reason === null ? [] : this.named('Reason', this.inline.typed(closing.reason))),
      ...(closing.issue === null ? [] : this.named('Issue', this.inline.typed(closing.issue))),
    ]
  }

  // Where the card comes from is read after the card, when it is read at all: it comes last. What the owner asked
  // for is context, not part of what was found: each request is drawn as they typed it, on one line, the one it
  // starts with.
  private source(): string[] {
    const { provenance, written } = this.record
    const { session, unit, commit, requests } = provenance
    const where = session === null ? 'none' : `${session}${unit === null ? '' : `, unit ${String(unit)}`}`
    const asked = requests.map((request) => this.oneLine(request))

    return [
      ...this.titled('Where it comes from'),
      '',
      ...this.named('Session', this.inline.typed(where)),
      ...(commit === null ? [] : this.named('Commit', this.inline.typed(commit.slice(0, HASH_LENGTH)))),
      ...(written === null ? [] : this.named('Writer', this.inline.typed(this.look(written)))),
      ...asked.flatMap((line, index) => this.named(index === 0 ? 'Asked' : '', [line])),
    ]
  }

  private look({ writer, look }: NonNullable<CardRecord['written']>): string {
    const who = writer.model === null ? writer.runtime : `${writer.runtime} on ${writer.model}`

    return `${who}: ${LOOK[look.verdict]}. ${look.note}`.trimEnd()
  }

  // What a card that waits is for: a decision, and what is found on the way to it.
  private next(): string[] {
    const number = String(this.record.number)
    const hints = [
      `Write on it with weaver note ${number} [${NoteText.CONCLUSIONS.join('|')}] <text>.`,
      `Close it with weaver close ${number} ${Card.CLOSINGS.join('|')} [reason].`,
    ]

    return this.card.isWaiting ? hints.flatMap((hint) => this.wrapped.of(this.dimmed(hint))) : []
  }

  private titled(title: string): string[] {
    return this.markdown.lines(`## ${title}`)
  }

  // A name, and what it says folded under its first word.
  private named(name: string, said: readonly Atom[]): string[] {
    return this.wrapped.of(said, `${INDENT}${this.paint.dim(name.padEnd(NAME_WIDTH))}${INDENT}`, ' '.repeat(SAID_AT))
  }

  private dimmed(text: string): Atom[] {
    return this.inline.typed(text, (word) => this.paint.dim(word))
  }

  // An atom is never cut by a line: this one is as wide as what is left of the page at most.
  private oneLine(text: string): Atom {
    const room = Math.max(1, this.width - SAID_AT)
    const [first = ''] = text.trim().split('\n')
    const line = first.replaceAll(/\s+/g, ' ')
    const shown = line.length > room || first !== text.trim() ? `${line.slice(0, room - 1).trimEnd()}${CUT}` : line

    return { text: shown, width: shown.length }
  }

  private author({ author, role, subagent }: Provenance): string {
    const who = role === 'owner' ? 'the owner' : author

    return subagent === null ? who : `${who}, in a subagent`
  }
}
