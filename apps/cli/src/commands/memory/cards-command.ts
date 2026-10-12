import { realpathSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { PlaceText, type Card, type CardFilter, type CardState } from '@weaver/memory'
import { Counted } from '../../output/counted.ts'
import type { Output } from '../../output/output.ts'
import { Screen } from '../../output/screen.ts'
import { Project } from '../../project/project.ts'
import type { Command } from '../line/command.ts'

interface Asked {
  readonly all: boolean
  readonly file: string | null
  readonly label: string | null
}

const EVERY_STATE: readonly CardState[] = ['raw', 'open', 'closed', 'merged']

export class CardsCommand implements Command {
  readonly name = 'cards'
  readonly usage = 'cards [<number>] [--all] [--file <path>] [--label <family:value>]'
  readonly summary = 'List the cards that wait for you, or print one'
  readonly ownerOnly = false
  readonly help = {
    group: 'Cards',
    description: 'List the cards that wait for you, newest first, or print one as Markdown.',
    words: [
      ['[<number>]', 'Print this card as Markdown'],
      ['--all', 'List the closed and the merged cards too'],
      ['--file <path>', 'Only the cards about this file'],
      ['--label <family:value>', 'Only the cards that carry this label'],
    ],
    examples: ['weaver cards', 'weaver cards 12', 'weaver cards --all --file src/auth/token.ts'],
  } as const
  private readonly cwd: string
  private readonly screen: Screen

  constructor(cwd: string, output: Output) {
    this.cwd = cwd
    this.screen = new Screen(output)
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
    let asked: Asked = { all: false, file: null, label: null }

    while (words.length > 0) {
      const word = words.shift()

      if (word === '--all') asked = { ...asked, all: true }
      else if (word === '--file' && words.length > 0) asked = { ...asked, file: words.shift() ?? null }
      else if (word === '--label' && words.length > 0) asked = { ...asked, label: words.shift() ?? null }
      else return null
    }

    return asked
  }

  private async show(number: number): Promise<number> {
    const registry = Project.locate(this.cwd).recordedRegistry()

    try {
      const card = registry?.find(number) ?? null

      if (card === null) throw new Error(`no card has the number ${String(number)}`)

      await this.screen.markdown(card.markdown())

      return 0
    } finally {
      registry?.close()
    }
  }

  private list({ all, file, label }: Asked): number {
    const project = Project.locate(this.cwd)
    const filter: CardFilter = {
      ...(all ? { states: EVERY_STATE } : {}),
      // The registry names a file from the top of the repository, and the owner from where they stand.
      ...(file === null ? {} : { file: relative(project.top, resolve(realpathSync(this.cwd), file)) }),
      ...(label === null ? {} : { label }),
    }
    const registry = project.recordedRegistry()

    try {
      const cards = (registry?.list(filter) ?? []).toReversed()

      if (cards.length === 0) {
        this.screen.line(Object.keys(filter).length === 0 ? 'Nothing waits for you.' : 'No card matches.')

        return 0
      }

      const rows = cards.map((card) => this.row(card, project))
      const widths = [0, 1].map((column) => Math.max(...rows.map((row) => (row[column] ?? '').length)))
      const waiting = new Counted(cards.length, 'card waits', 'cards wait').text

      this.screen.line(this.screen.bold(all ? new Counted(cards.length, 'card').text : `${waiting} for you`))

      for (const [number = '', standing = '', what = '', ...under] of rows) {
        const start = `  ${number.padEnd(widths[0] ?? 0)}  ${standing.padEnd(widths[1] ?? 0)}  `

        this.screen.line()
        this.screen.line(`${start}${what}`)
        for (const line of under) this.screen.line(`${' '.repeat(start.length)}${this.screen.dim(line)}`)
      }

      this.screen.line()
      this.screen.hint('Read one with weaver cards <number>, and close it with weaver close <number> fixed|wontfix|issue [reason].')

      return 0
    } finally {
      registry?.close()
    }
  }

  // The number of a card, how it stands and what it is about, then what goes under it: where it is, and the places
  // whose line changed since. A line that changed is a hint to look again, never a closing: the thing may have moved,
  // or be fixed.
  private row(card: Card, project: Project): string[] {
    const [first, ...others] = card.places
    const where = first === undefined ? [] : [`${PlaceText.write(first)}${others.length === 0 ? '' : ` +${String(others.length)}`}`]
    const changed = card.isWaiting ? card.changedPlaces((file) => project.read(file)) : []
    const since = changed.length === 0 ? [] : [`changed since: ${changed.map((place) => PlaceText.write(place)).join(', ')}`]

    return [`#${String(card.number)}`, card.standing, card.title, ...where, ...since]
  }
}
