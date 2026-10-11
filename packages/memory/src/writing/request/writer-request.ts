import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AnswerSchema } from '@weaver/agent-sdk'
import type { Card } from '../../cards/card.ts'
import type { CommitNote, PlaceContext } from '../../flags/flag-record.ts'
import { PlaceText } from '../../flags/place-text.ts'
import { oneLine } from '../../lib/text/clip.ts'
import { fenced } from '../../lib/text/fence.ts'
import { VERDICTS } from '../answer/answer-reader.ts'
import type { WriterJob } from './writer-job.ts'

const TEXT = { type: 'string' }
const TEXT_OR_NONE = { type: ['string', 'null'] }
// What the sections the owner agreed on hold. A project that names others says what they hold in its skill.
const HOLDS: ReadonlyMap<string, string> = new Map([
  ['Observation', 'what was seen, and where'],
  ['Context', 'what the agent was doing, and why it matters'],
  ['Trace', 'how the agent came across it'],
  ['Uncertainties', 'what was not verified'],
])
const LINES: Readonly<Record<PlaceContext['origin'], string>> = {
  before: 'These lines were there before the work the flag was made in.',
  unit: 'These lines were written by the work the flag was made in.',
  unknown: 'Whether these lines were there before the work the flag was made in is not known.',
}

export class WriterRequest {
  private readonly job: WriterJob
  private readonly flags: readonly Card[]
  private readonly known: readonly Card[]

  // `known` are the cards that already name the files of these flags.
  constructor(job: WriterJob, flags: readonly Card[], known: readonly Card[]) {
    this.job = job
    this.flags = flags
    this.known = known
  }

  // The writer is not given the conversation of the agent that flagged: a second look is worth something only when
  // it is independent.
  prompt(): string {
    const { sections } = this.job.settings

    return [
      'You are writing cards for the owner of this repository.',
      '',
      'While it worked on something else, an agent came across things it left aside, and reported each of them in a few lines: a flag. The owner may flag something the same way. You turn each flag below into a card: the document the owner reads later to decide what to do about it, which may be to fix it, to open an issue, or to leave it.',
      '',
      'For each flag:',
      '',
      '- Gather the context: read the files it names, and look up what you need to understand what it is about.',
      '- Look at the place to see whether what the flag says is true. A flag is a claim to look at, not a fact.',
      '- Write the card.',
      '',
      'You only read: run nothing of the project, no test, no build, no script, and change no file. Do not investigate either: do not look for the cause, do not try to reproduce the problem, do not look for proof. That is the work of whoever opens an issue afterwards.',
      '',
      'A card gives enough context to be understood alone, months later, by someone who saw neither the flag nor the work it came from. It is neither an investigation nor a certainty: it says what was seen and where, and what was not verified.',
      ...this.section('How this project wants its cards written', this.skill()),
      ...this.section('The sections of a card', [
        'Every card has these sections, in this order. Each is Markdown, with a list, a quote of the code or a diagram where it helps.',
        '',
        ...sections.map((name) => (HOLDS.has(name) ? `- ${name}: ${HOLDS.get(name) ?? ''}.` : `- ${name}`)),
      ]),
      ...this.section('The labels of this project', this.labels()),
      ...this.section('Cards already known on these files', this.cards()),
      ...this.section(
        'The flags',
        this.flags.flatMap((flag, index) => [...(index === 0 ? [] : ['']), ...this.flag(flag)]),
      ),
      ...this.section('Your answer', this.answer()),
    ].join('\n')
  }

  // Both runtimes hold the answer to this shape, so every field is required and one that has nothing to say is null.
  schema(): AnswerSchema {
    const card = this.shape({
      flag: { type: 'integer', enum: this.flags.map((flag) => flag.number) },
      title: TEXT,
      labels: { type: 'array', items: this.shape({ family: this.oneOf(Object.keys(this.job.labels)), value: TEXT }) },
      sections: { type: 'array', items: this.shape({ name: this.oneOf(this.job.settings.sections), text: TEXT }) },
      look: this.shape({ verdict: this.oneOf(VERDICTS), note: TEXT }),
      sameAs: { type: ['integer', 'null'] },
      sure: { type: 'boolean' },
      sameNote: TEXT_OR_NONE,
    })

    return this.shape({ cards: { type: 'array', items: card } })
  }

  private shape(properties: Readonly<Record<string, unknown>>): AnswerSchema {
    return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties }
  }

  // A list of no value at all is not a schema a runtime takes.
  private oneOf(values: readonly string[]): AnswerSchema {
    return values.length === 0 ? TEXT : { type: 'string', enum: values }
  }

  private section(title: string, lines: readonly string[]): string[] {
    return lines.length === 0 ? [] : ['', `## ${title}`, '', ...lines]
  }

  private block(title: string, lines: readonly string[]): string[] {
    return lines.length === 0 ? [] : ['', title, '', ...lines]
  }

  // A project may name its skill before it has written it.
  private skill(): string[] {
    const { skill } = this.job.settings

    return skill === null || !existsSync(join(this.job.top, skill)) ? [] : [`Read ${skill} first, and follow it.`]
  }

  private labels(): string[] {
    const declared = Object.entries(this.job.labels).flatMap(([family, values]) =>
      Object.entries(values).map(([value, meaning]) => `- ${family}:${value}: ${oneLine(meaning)}`),
    )

    return declared.length === 0
      ? []
      : ['A card takes its labels from this list and from nowhere else. Give the ones that fit: a card may have none.', '', ...declared]
  }

  private cards(): string[] {
    const lines = this.known.map((card) => {
      const reason = card.record.closing?.reason ?? null

      return `- ${card.oneLine()}${reason === null ? '' : ` (the owner's reason: ${oneLine(reason)})`}`
    })

    return lines.length === 0
      ? []
      : ['A flag may be about the same thing as one of these. A closed card was decided by the owner.', '', ...lines]
  }

  private flag(card: Card): string[] {
    const { flag, places, provenance } = card.record

    return [
      `### Flag #${String(card.number)}`,
      '',
      provenance.role === 'owner'
        ? 'Made by the owner.'
        : `Made by ${provenance.author}, as ${provenance.role} of the work it was made in.`,
      places.length === 0 ? 'Places: none, the flag names no file.' : `Places: ${places.map((place) => PlaceText.write(place)).join(', ')}`,
      ...this.block(
        'What the owner had asked for, in the work this flag was made in:',
        provenance.requests.map((request, index) => `${String(index + 1)}. ${request}`),
      ),
      '',
      'The flag, word for word:',
      '',
      fenced(flag?.text ?? '', 'text'),
      ...(flag?.context ?? []).flatMap((kept) => this.kept(kept)),
    ]
  }

  // The lines as they were when the flag was made: the files may have changed since.
  private kept({ place, exists, excerpt, origin, wroteBy, lastCommits }: PlaceContext): string[] {
    const name = PlaceText.write(place)

    if (!exists) return ['', `${name} was not there when the flag was made.`]

    return [
      '',
      excerpt === '' ? `${name}, when the flag was made:` : `${name}, when the flag was made. ${LINES[origin]}`,
      ...this.commits('Commits that wrote these lines:', wroteBy),
      ...this.commits('Last commits of the file:', lastCommits),
      ...(excerpt === '' ? [] : ['', fenced(excerpt, 'text')]),
    ]
  }

  private commits(title: string, commits: readonly CommitNote[]): string[] {
    return commits.length === 0 ? [] : [title, ...commits.map(({ hash, date, subject }) => `- ${hash} ${date} ${subject}`)]
  }

  private answer(): string[] {
    const declared = Object.keys(this.job.labels).length > 0

    return [
      'One entry in `cards` for each flag above, and no other.',
      '',
      '- `flag`: the number of the flag.',
      '- `title`: one short line that names the thing, as the owner would look for it in a list.',
      declared
        ? '- `labels`: the labels that fit, each with its `family` and its `value`: for `type:bug` in the list above, the family is `type` and the value is `bug`. An empty list when none fits.'
        : '- `labels`: an empty list, since this project declares no label.',
      '- `sections`: every section named above, each with its `name` as written there and its `text`.',
      '- `look`: what you saw when you looked at the place. `verdict` is `agrees` when what you read agrees with the flag, `contradicts` when it contradicts it, and `cannot-tell` when it does not let you tell. `note` says what you read.',
      '- `sameAs`: the number of a card already known, or of a flag earlier in this list, that is about the same thing; null when there is none. `sure` is true only when you are sure of it: two things that only look alike stay two cards. `sameNote` says in one sentence why they are the same thing, and is null when `sameAs` is.',
    ]
  }
}
