import {
  NoteReport,
  PlaceText,
  type Card,
  type CardNote,
  type CardRecord,
  type PlaceContext,
  type Provenance,
  type ReviewContent,
} from '@weaver/memory'
import type { Atom } from '../../markdown/atom.ts'
import { DrawnCode, type NumberedLine } from '../../markdown/drawn-code.ts'
import { InlineMarkdown } from '../../markdown/inline-markdown.ts'
import { TerminalMarkdown } from '../../markdown/terminal-markdown.ts'
import { WrappedLines } from '../../markdown/wrapped-lines.ts'
import { LocalMoment } from '../../output/local-moment.ts'
import type { Paint } from '../../output/paint.ts'
import { CONCLUDED } from '../theme/marks.ts'
import { CardSides, type SheetTab } from './card-sides.ts'

// A part of a side: what it holds, under a heading when it has one.
interface Part {
  // The heading, drawn; null for a part that goes on from the one before.
  readonly head: string | null
  readonly lines: readonly string[]
}

const NAME_WIDTH = 9
const HASH_LENGTH = 12
const CUT = '…'
// The mark that opens a heading.
const HEADING = '▍'
// What a side nothing was written on says.
const NOTHING: Readonly<Record<Exclude<SheetTab, 'card' | 'flag'>, string>> = {
  investigation: 'Nobody has looked into this card yet.',
  fix: 'Nobody has reported a fix of this card yet.',
  notes: 'Nothing is written on this card yet.',
}
const DID = { left: 'left as it is', 'worked-around': 'worked around', fixed: 'fixed in the task' } as const
const LOOK = { agrees: 'agrees with the flag', contradicts: 'contradicts the flag', 'cannot-tell': 'could not tell' } as const
const WRITTEN: Readonly<Record<PlaceContext['origin'], string>> = {
  before: ', lines from before the unit of work',
  unit: ', lines the unit of work wrote',
  unknown: '',
}

// A card as the detail of the interface shows it, one side at a time. It is drawn from what the card holds, as the
// page of the command line is, with the look of the interface: a part opens under a heading that stands out and is
// given room, and code stands on a ground.
export class CardSheet {
  private readonly record: CardRecord
  private readonly sides: CardSides
  private readonly paint: Paint
  private readonly width: number
  private readonly markdown: TerminalMarkdown
  // What is drawn beside the name of a field.
  private readonly beside: TerminalMarkdown
  private readonly inline: InlineMarkdown
  private readonly wrapped: WrappedLines
  private readonly code: DrawnCode

  constructor(card: Card, paint: Paint, width: number) {
    this.record = card.record
    this.sides = new CardSides(card)
    this.paint = paint
    this.markdown = new TerminalMarkdown(paint, width)
    this.beside = new TerminalMarkdown(paint, width - NAME_WIDTH - 1)
    this.width = this.markdown.width
    this.inline = new InlineMarkdown(paint)
    this.wrapped = new WrappedLines(this.width)
    this.code = new DrawnCode(paint, width)
  }

  // A heading has an empty line under it, and two above it: it belongs to what follows. A part without a heading
  // goes on from the one before, an empty line apart.
  lines(tab: SheetTab): string[] {
    const parts = (tab === 'card' ? this.written() : tab === 'flag' ? this.origin() : this.noted(tab)).filter(
      (part) => part.head !== null || part.lines.length > 0,
    )

    return parts.flatMap(({ head, lines }, index) => {
      const apart = index === 0 ? [] : head === null ? [''] : ['', '']
      const under = head === null ? lines : [head, ...(lines.length === 0 ? [] : ['', ...lines])]

      return [...apart, ...under]
    })
  }

  // What the card says: the sections of its writer, what a review left, or its flag while nobody wrote it up.
  private written(): Part[] {
    const { review, written, flag } = this.record
    const alerts = this.loose(this.alerts())

    if (review !== null) return [alerts, ...this.review(review)]
    if (written !== null) return [alerts, ...written.sections.map(({ name, text }) => this.titled(name, this.markdown.lines(text.trim())))]

    return [
      alerts,
      this.loose(flag === null ? [] : [this.paint.dim('No writer has written this card up yet. Its flag says:'), '', ...this.fields()]),
    ]
  }

  private alerts(): string[] {
    const { written, writing, seenSinceClosing } = this.record
    const alerts = [
      ...(written?.look.verdict === 'contradicts' ? ['What the writer read contradicts the flag: see Writer, under Flag.'] : []),
      ...(writing.failure === null ? [] : [`Writing it up failed, ${String(writing.attempts)} times: ${writing.failure}`]),
      ...(seenSinceClosing ? ['Seen again since it was closed.'] : []),
    ]

    return alerts.flatMap((alert) => this.wrapped.of(this.inline.typed(alert), `${this.paint.yellow('!')} `, '  '))
  }

  private review(content: ReviewContent): Part[] {
    const { review, rule, statement, message, quote, suggestion, evidence, standing } = content
    const language = DrawnCode.languageOf(this.record.places[0]?.file ?? '')

    return [
      this.titled(this.record.origin === 'suspicion' ? 'Suspicion' : 'Finding', this.markdown.lines(message.trim())),
      this.loose(
        this.fielded([
          this.named('Review', review),
          rule === null ? [] : this.named('Rule', statement === null ? rule : `${rule}: ${statement}`),
          this.named('Waits', standing),
        ]),
      ),
      ...(quote === null ? [] : [this.titled('The line as the reviewer read it', this.code.block(quote, language))]),
      ...(suggestion === null ? [] : [this.titled('Suggestion', this.markdown.lines(suggestion.trim()))]),
      ...(evidence === null ? [] : [this.titled('Evidence', this.markdown.lines(evidence.trim()))]),
    ]
  }

  // Where the card comes from: its flag, the lines it pointed at, what happened to it, and who made it.
  private origin(): Part[] {
    const { flag, occurrences, ties, closing } = this.record
    const again = occurrences.flatMap(({ card, provenance, note }) =>
      this.wrapped.of(
        [
          ...this.dimmed(`${this.when(provenance)}, ${this.author(provenance)}${card === null ? '' : `, as card #${String(card)}`}:`),
          ...this.inline.typed(note),
        ],
        `${this.paint.dim('•')} `,
        '  ',
      ),
    )

    return [
      ...(flag === null ? [] : [this.titled('Flag', this.fields())]),
      ...(flag?.context ?? []).map((context) => this.loose(this.kept(context))),
      ...(again.length === 0 ? [] : [this.titled('Occurrences', again)]),
      ...(ties.length === 0 ? [] : [this.titled('Ties', [`May be the same thing as ${ties.map((tie) => `#${String(tie)}`).join(', ')}.`])]),
      ...(closing === null
        ? []
        : [
            this.titled(
              'Closing',
              this.fielded([
                this.named('As', closing.as),
                this.named('On', new LocalMoment(closing.at).text),
                closing.reason === null ? [] : this.named('Reason', closing.reason),
                closing.issue === null ? [] : this.named('Issue', closing.issue),
              ]),
            ),
          ]),
      this.source(),
    ]
  }

  private fields(): string[] {
    const { flag } = this.record

    if (flag === null) return []

    const { seen, expected, found, checked, did, didNote } = flag.fields

    return this.fielded([
      this.named('Seen', seen),
      this.named('Expected', expected),
      this.named('Found', found),
      this.named('Checked', checked),
      this.named('Did', didNote === null ? DID[did] : `${DID[did]}: ${didNote}`),
    ])
  }

  // Fields one under the other. Where one of them takes several lines, an empty line sets each apart: they would
  // read as one block of text otherwise.
  private fielded(fields: readonly (readonly string[])[]): string[] {
    const given = fields.filter((field) => field.length > 0)
    const apart = given.some((field) => field.length > 1)

    return given.flatMap((field, index) => (apart && index > 0 ? ['', ...field] : field))
  }

  private kept({ place, exists, excerpt, origin }: PlaceContext): string[] {
    const where = this.inline.typed(PlaceText.write(place), (word) => this.paint.magenta(word))

    if (!exists) return this.wrapped.of([...where, ...this.inline.typed('was not there when it was flagged.')])
    if (excerpt === '') return []

    // An excerpt is kept as text: each line after its number and two spaces.
    const lines = excerpt.split('\n').flatMap((line): NumberedLine[] => {
      const [, number, text = ''] = /^\s*(\d+) {2}(.*)$/.exec(line) ?? []

      return number === undefined ? [] : [{ number: Number(number), text }]
    })
    const language = DrawnCode.languageOf(place.file)

    return [
      ...this.wrapped.of([...where, ...this.dimmed(`as it was when flagged${WRITTEN[origin]}`)]),
      ...(lines.length === 0 ? this.code.block(excerpt, language) : this.code.excerpt(lines, language, place.line)),
    ]
  }

  private source(): Part {
    const { provenance, written } = this.record
    const { session, unit, commit, requests } = provenance
    const where = session === null ? 'none' : `${session}${unit === null ? '' : `, unit ${String(unit)}`}`
    const writer =
      written === null
        ? null
        : `${written.writer.model === null ? written.writer.runtime : `${written.writer.runtime} on ${written.writer.model}`}: ${LOOK[written.look.verdict]}. ${written.look.note}`.trimEnd()

    return this.titled(
      'Where it comes from',
      this.fielded([
        this.named('Session', where),
        commit === null ? [] : this.named('Commit', commit.slice(0, HASH_LENGTH)),
        writer === null ? [] : this.named('Writer', writer),
        requests.flatMap((request, index) => this.asked(index === 0 ? 'Asked' : '', request)),
      ]),
    )
  }

  // What was written on one side of the card since it was made, in order: who, what they conclude and when, then
  // what they say.
  private noted(tab: keyof typeof NOTHING): Part[] {
    const parts = [
      ...(tab === 'fix' ? this.claimed() : []),
      ...this.sides.notesOf(tab).map((note) => ({ head: this.signed(note), lines: this.said(note) })),
    ]

    return parts.length === 0 ? [this.loose([this.paint.dim(NOTHING[tab])])] : parts
  }

  // A flag that says its author fixed the thing is all the card holds of that fix: no report was asked for it.
  private claimed(): Part[] {
    const { flag, provenance } = this.record

    if (flag === null || !this.sides.bornFixed) return []

    return [
      {
        head: `${this.signed({ provenance, conclusion: 'fixed' })}  ${this.paint.dim('in its flag')}`,
        lines:
          flag.fields.didNote === null
            ? [this.paint.dim('The flag says that it was fixed in the task, and no more.')]
            : this.markdown.typed(flag.fields.didNote),
      },
    ]
  }

  // The fields of a report one under the other, after what the note says before them. A note that gives no field
  // is drawn as the text it is.
  private said({ conclusion, text }: CardNote): string[] {
    const report = conclusion === null ? null : new NoteReport(conclusion, text)
    const fields = report?.fields ?? []

    if (report === null || fields.length === 0) return this.markdown.typed(text)

    const drawn = this.fielded(fields.map(({ name, said }) => this.reported(name, said)))

    return report.opening === '' ? drawn : [...this.markdown.typed(report.opening), '', ...drawn]
  }

  // A field of a report: its name, and beside it what it says, which is Markdown as a note is.
  private reported(name: string, said: string): string[] {
    const lines = this.beside.typed(said)

    return (lines.length === 0 ? [''] : lines).map((line, index) =>
      `${index === 0 ? this.paint.dim(name.padEnd(NAME_WIDTH)) : ' '.repeat(NAME_WIDTH)} ${line}`.trimEnd(),
    )
  }

  private signed({ provenance, conclusion }: Pick<CardNote, 'provenance' | 'conclusion'>): string {
    const concluded = conclusion === null ? [] : [this.concluded(conclusion)]

    return [
      `${this.paint.magenta(HEADING)} ${this.paint.bold(this.author(provenance))}`,
      ...concluded,
      this.paint.dim(this.when(provenance)),
    ].join('  ')
  }

  private concluded(conclusion: NonNullable<CardNote['conclusion']>): string {
    const said = `${CONCLUDED[conclusion].mark} ${conclusion}`

    if (conclusion === 'confirmed') return this.paint.green(said)
    if (conclusion === 'refuted') return this.paint.red(said)

    return conclusion === 'fixed' ? this.paint.blue(said) : said
  }

  // A part under its heading: the name in capitals and in bold, after the mark of the interface.
  private titled(name: string, lines: readonly string[]): Part {
    return { head: `${this.paint.magenta(HEADING)} ${this.paint.bold(name.toUpperCase())}`, lines }
  }

  private loose(lines: readonly string[]): Part {
    return { head: null, lines }
  }

  // A name, and what it says folded under its first word.
  private named(name: string, said: string): string[] {
    return this.wrapped.of(this.inline.typed(said), `${this.paint.dim(name.padEnd(NAME_WIDTH))} `, ' '.repeat(NAME_WIDTH + 1))
  }

  // What the owner asked for is context: each request is drawn on one line, the one it starts with.
  private asked(name: string, request: string): string[] {
    const room = Math.max(1, this.width - NAME_WIDTH - 1)
    const [first = ''] = request.trim().split('\n')
    const line = first.replaceAll(/\s+/g, ' ')
    const shown = line.length > room || first !== request.trim() ? `${line.slice(0, room - 1).trimEnd()}${CUT}` : line
    const atom: Atom = { text: shown, width: shown.length }

    return this.wrapped.of([atom], `${this.paint.dim(name.padEnd(NAME_WIDTH))} `, ' '.repeat(NAME_WIDTH + 1))
  }

  private dimmed(text: string): Atom[] {
    return this.inline.typed(text, (word) => this.paint.dim(word))
  }

  private when({ at }: Provenance): string {
    return new LocalMoment(at).text
  }

  private author({ author, role, subagent }: Provenance): string {
    const who = role === 'owner' ? 'the owner' : author

    return subagent === null ? who : `${who}, in a subagent`
  }
}
