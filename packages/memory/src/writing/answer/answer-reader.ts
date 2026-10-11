import type { WriterLook, WrittenCard } from '../../cards/card-record.ts'
import { oneLine } from '../../lib/text/clip.ts'
import type { LabelCatalog } from '../request/writer-job.ts'

export interface FlagAnswer extends Pick<WrittenCard, 'title' | 'labels' | 'sections' | 'look'> {
  // The card it reads as the same thing, among those it may name; null when it names none.
  readonly sameAs: number | null
  readonly sure: boolean
  readonly sameNote: string | null
}

type Fields = Readonly<Record<string, unknown>>

export const VERDICTS: readonly WriterLook['verdict'][] = ['agrees', 'contradicts', 'cannot-tell']

// What can be made of the writer's answer for a flag: a card with every section the project asks for and only the
// labels it declares, or the reason there is none.
export class AnswerReader {
  private readonly labels: LabelCatalog
  private readonly sections: readonly string[]

  constructor(labels: LabelCatalog, sections: readonly string[]) {
    this.labels = labels
    this.sections = sections
  }

  // The answer for this flag, or why it has none. `known` are the cards the writer may name as the same thing.
  read(answer: unknown, flag: number, known: readonly number[]): FlagAnswer | string {
    const cards = this.fields(answer)?.cards

    if (!Array.isArray(cards)) return 'the writer answered without a list of cards'

    const given = cards.map((card) => this.fields(card)).find((card) => card?.flag === flag)

    if (given === undefined || given === null) return 'the answer of the writer has no card for this flag'

    const title = this.text(given.title)
    const look = this.look(given.look)
    const sections = this.sections.map((name) => ({ name, text: this.section(given.sections, name) }))
    const missing = sections.flatMap(({ name, text }) => (text === null ? [name] : []))

    if (title === null) return 'the card of the writer has no title'
    if (missing.length > 0)
      return `the card of the writer misses ${missing.length === 1 ? 'the section' : 'the sections'} ${missing.join(', ')}`
    if (look === null) return 'the card of the writer does not say what it saw when it looked'

    return {
      title: oneLine(title),
      labels: this.declared(given.labels),
      sections: sections.map(({ name, text }) => ({ name, text: text ?? '' })),
      look,
      sameAs: typeof given.sameAs === 'number' && known.includes(given.sameAs) ? given.sameAs : null,
      sure: given.sure === true,
      sameNote: this.text(given.sameNote),
    }
  }

  private section(given: unknown, name: string): string | null {
    const written = this.list(given)
      .map((section) => this.fields(section))
      .find((section) => section?.name === name)

    return this.text(written?.text)
  }

  private look(given: unknown): WriterLook | null {
    const fields = this.fields(given)
    const verdict = VERDICTS.find((known) => known === fields?.verdict)

    return verdict === undefined ? null : { verdict, note: this.text(fields?.note) ?? '' }
  }

  // The labels the project declares, in its order: one the writer made up is dropped. A value may come with its
  // family in front, as the list shown to the writer writes it.
  private declared(given: unknown): Record<string, string[]> {
    const said = this.list(given).map((label) => this.fields(label))
    const kept = Object.entries(this.labels).map(([family, values]): [string, string[]] => [
      family,
      Object.keys(values).filter((value) =>
        said.some((label) => label?.family === family && (label.value === value || label.value === `${family}:${value}`)),
      ),
    ])

    return Object.fromEntries(kept.filter(([, values]) => values.length > 0))
  }

  private list(value: unknown): unknown[] {
    return Array.isArray(value) ? value : []
  }

  private fields(value: unknown): Fields | null {
    return typeof value === 'object' && value !== null ? (value as Fields) : null
  }

  private text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
  }
}
