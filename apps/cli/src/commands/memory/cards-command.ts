import { realpathSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import {
  Card,
  CardListing,
  LabelFamilies,
  NoteText,
  PlaceText,
  type CardFilter,
  type CardOrder,
  type CardState,
  type Closing,
} from '@weaver/memory'
import type { Caller } from '../../caller/caller.ts'
import { Period } from '../../numbers/period.ts'
import { Counted } from '../../output/counted.ts'
import type { Output } from '../../output/output.ts'
import { Screen } from '../../output/screen.ts'
import { Project } from '../../project/project.ts'
import type { Command } from '../line/command.ts'

interface Asked {
  readonly all: boolean
  // Only the closed cards; with a way of closing, only those closed that way.
  readonly closed: boolean
  readonly closedAs: Closing | null
  readonly file: string | null
  // Each as `family:value`.
  readonly labels: readonly string[]
  readonly since: Date | null
  readonly answered: boolean
  // Words that what a card says must hold.
  readonly words: string
  readonly order: CardOrder
}

const EVERY_STATE: readonly CardState[] = ['raw', 'open', 'closed', 'merged']
const ORDERS: readonly CardOrder[] = ['newest', 'level']

export class CardsCommand implements Command {
  readonly name = 'cards'
  readonly usage = `cards [<number>] [--all] [--closed [${Card.CLOSINGS.join('|')}]] [--file <path>] [--label <family:value>]... [--since <day>|<n>d] [--answered] [--search <words>] [--sort newest|level]`
  readonly summary = 'List the cards that wait for you, or show one'
  readonly ownerOnly = false
  readonly help = {
    group: 'Cards',
    description: 'List the cards that wait for you, newest first, or show one: drawn at a terminal, as Markdown for a program.',
    words: [
      ['[<number>]', 'Show this card'],
      ['--all', 'List the closed and the merged cards too'],
      [`--closed [${Card.CLOSINGS.join('|')}]`, 'Only the closed cards; with a way of closing, only those closed that way'],
      ['--file <path>', 'Only the cards about this file'],
      ['--label <family:value>', 'Only the cards that carry this label; given several times, one of the values of each family named'],
      ['--since <day>|<n>d', 'Only the cards made since a day, as 2026-10-01, or in the last days, as 7d'],
      ['--answered', 'Only the cards someone concluded on'],
      ['--search <words>', 'Only the cards that say these words: in their text, their notes, or the reason they were closed for'],
      ['--sort newest|level', 'The newest first, or the gravest first by the level the project grades its cards with'],
    ],
    examples: [
      'weaver cards',
      'weaver cards 12',
      'weaver cards --all --file src/auth/token.ts',
      'weaver cards --label level:high --label area:api --sort level',
      'weaver cards --closed wontfix',
    ],
  } as const
  private readonly cwd: string
  private readonly screen: Screen
  private readonly caller: Caller

  constructor(cwd: string, output: Output, caller: Caller) {
    this.cwd = cwd
    this.screen = new Screen(output)
    this.caller = caller
  }

  run(args: readonly string[]): number | Promise<number> {
    const [first = ''] = args

    if (args.length === 1 && /^\d+$/.test(first)) return this.show(Number(first))

    const asked = this.asked(args)

    if (asked !== null) return this.list(asked)

    this.screen.misuse(this.name, this.usage)

    return 2
  }

  private asked(args: readonly string[]): Asked | null {
    const words = [...args]
    let asked: Asked = {
      all: false,
      closed: false,
      closedAs: null,
      file: null,
      labels: [],
      since: null,
      answered: false,
      words: '',
      order: 'newest',
    }

    while (words.length > 0) {
      const word = words.shift()
      const value = words[0] ?? ''

      const closing = Card.CLOSINGS.find((known) => known === value)

      if (word === '--all') asked = { ...asked, all: true }
      else if (word === '--answered') asked = { ...asked, answered: true }
      else if (word === '--closed') {
        // The way of closing may follow, or not: `--closed` alone is every closed card.
        if (closing !== undefined) words.shift()
        asked = { ...asked, closed: true, closedAs: closing ?? null }
      } else if (word === '--search' && words.length > 0) asked = { ...asked, words: words.shift() ?? '' }
      else if (word === '--file' && words.length > 0) asked = { ...asked, file: words.shift() ?? null }
      else if (word === '--label' && /^[^:]+:[^:]+$/.test(value)) asked = { ...asked, labels: [...asked.labels, words.shift() ?? ''] }
      else if (word === '--since' && Period.from(value) !== null)
        asked = { ...asked, since: Period.from(words.shift() ?? '')?.since ?? null }
      else if (word === '--sort' && ORDERS.some((order) => order === value))
        asked = { ...asked, order: words.shift() === 'level' ? 'level' : 'newest' }
      else return null
    }

    return asked
  }

  private async show(number: number): Promise<number> {
    const registry = Project.locate(this.cwd).recordedRegistry()

    try {
      const card = registry?.find(number) ?? null

      if (card === null) throw new Error(`no card has the number ${String(number)}`)

      // The parser of Markdown and the grammars of the languages are loaded here, to draw a card: no other command
      // pays for them.
      await this.screen.page([card.markdown(), ...this.answering(card)].join('\n\n'), async (paint, width) => {
        const { CardPage } = await import('../../cards/card-page.ts')

        return new CardPage(card, paint, width).lines()
      })

      return 0
    } finally {
      registry?.close()
    }
  }

  // An agent that reads a card is told how to write on it: what it finds would otherwise stay in its conversation.
  private answering(card: Card): string[] {
    if (this.caller.agent() === null || card.state === 'merged') return []

    return [
      '---',
      `[weaver] If the owner asked you to verify or to fix what this card says, report on the card when you are done, with the commands below: what you looked into, and what you fixed if you did. Weaver answers in their place, as it does for a flag, and refuses a report that leaves a field out.\n\n${NoteText.formatFor(String(card.number))}`,
    ]
  }

  private list({ all, closed, closedAs, file, labels, since, answered, words, order }: Asked): number {
    const project = Project.locate(this.cwd)
    const filter: CardFilter = {
      ...(closed ? { states: ['closed'] } : all ? { states: EVERY_STATE } : {}),
      // The registry names a file from the top of the repository, and the owner from where they stand.
      ...(file === null ? {} : { file: relative(project.top, resolve(realpathSync(this.cwd), file)) }),
    }
    const narrowed = Object.keys(filter).length > 0 || labels.length > 0 || since !== null || answered || words !== ''
    const registry = project.recordedRegistry()

    try {
      // The level a project grades its cards with is read only when the cards are put in that order.
      const scale = order === 'level' ? Object.keys(project.readableDeclaration()?.labels[LabelFamilies.LEVEL] ?? {}) : []
      const cards = new CardListing(registry?.list(filter) ?? [], scale)
        .narrowed({
          labels: this.wanted(labels),
          since: since?.toISOString() ?? null,
          answered,
          closedAs: closedAs === null ? [] : [closedAs],
          words,
        })
        .ordered(order)

      if (cards.length === 0) {
        this.screen.line(narrowed ? 'No card matches.' : 'Nothing waits for you.')

        return 0
      }

      const rows = cards.map((card) => this.row(card, project))
      // Put in order by level, each card says its level before what it is about.
      const columns = cards.map((card) => [
        `#${String(card.number)}`,
        card.standing,
        ...(scale.length === 0 ? [] : [card.valuesOf(LabelFamilies.LEVEL).join(', ') || '-']),
      ])
      const widths = (columns[0] ?? []).map((_, column) => Math.max(...columns.map((cells) => (cells[column] ?? '').length)))
      const waiting = new Counted(cards.length, 'card waits', 'cards wait').text

      this.screen.line(this.screen.bold(all || closed ? new Counted(cards.length, 'card').text : `${waiting} for you`))

      for (const [index, [what = '', ...under]] of rows.entries()) {
        const start = `  ${(columns[index] ?? []).map((cell, column) => cell.padEnd(widths[column] ?? 0)).join('  ')}  `

        this.screen.line()
        this.screen.line(`${start}${what}`)
        for (const line of under) this.screen.line(`${' '.repeat(start.length)}${this.screen.dim(line)}`)
      }

      this.screen.line()
      this.screen.hint(`Read one with weaver cards <number>, and close it with weaver close <number> ${Card.CLOSINGS.join('|')} [reason].`)

      return 0
    } finally {
      registry?.close()
    }
  }

  // The labels asked for, family by family: one of the values of each family is enough for a card to be listed.
  private wanted(labels: readonly string[]): Record<string, string[]> {
    const wanted: Record<string, string[]> = {}

    for (const label of labels) {
      const [family = '', value = ''] = label.split(':')

      wanted[family] = [...(wanted[family] ?? []), value]
    }

    return wanted
  }

  // What a card is about, then what goes under it: where it is, the places whose line changed since, and for a
  // closed card why it was closed and the issue it became. A line that changed is a hint to look again, never a
  // closing: the thing may have moved, or be fixed.
  private row(card: Card, project: Project): string[] {
    const [first, ...others] = card.places
    const where = first === undefined ? [] : [`${PlaceText.write(first)}${others.length === 0 ? '' : ` +${String(others.length)}`}`]
    const changed = card.isWaiting ? card.changedPlaces((file) => project.read(file)) : []
    const since = changed.length === 0 ? [] : [`changed since: ${changed.map((place) => PlaceText.write(place)).join(', ')}`]

    const { reason = null, issue = null } = card.record.closing ?? {}
    const closed = [
      ...(reason === null ? [] : [`reason: ${reason.replaceAll(/\s+/g, ' ').trim()}`]),
      ...(issue === null ? [] : [`issue: ${issue.trim()}`]),
    ]

    return [card.title, ...where, ...since, ...closed]
  }
}
