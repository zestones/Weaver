import { realpathSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { PlaceText, type Card, type CardFilter, type CardState } from '@weaver/memory'
import type { Output } from '../../output/output.ts'
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
  readonly summary = 'List the cards that wait for you, newest first, or print one as Markdown.'
  readonly ownerOnly = false
  private readonly cwd: string
  private readonly output: Output

  constructor(cwd: string, output: Output) {
    this.cwd = cwd
    this.output = output
  }

  run(args: readonly string[]): number {
    const [first = ''] = args

    if (args.length === 1 && /^\d+$/.test(first)) return this.show(Number(first))

    const asked = this.asked(args)

    if (asked !== null) return this.list(asked)

    this.output.say(`weaver ${this.usage}`)

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

  private show(number: number): number {
    const registry = Project.locate(this.cwd).recordedRegistry()

    try {
      const card = registry?.find(number) ?? null

      if (card === null) throw new Error(`no card has the number ${String(number)}`)

      this.output.say(card.markdown())

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
        this.output.say(Object.keys(filter).length === 0 ? 'Nothing waits for you.' : 'No card matches.')

        return 0
      }

      this.output.say(`${String(cards.length)} card(s)${all ? '' : ' wait for you'}:`)
      for (const card of cards) this.output.say(`  ${this.line(card, project)}`)
      this.output.say('Read one with weaver cards <number>, and close it with weaver close <number> fixed|wontfix|issue [reason].')

      return 0
    } finally {
      registry?.close()
    }
  }

  // A line that changed since is a hint to look again, never a closing: the thing may have moved, or be fixed.
  private line(card: Card, project: Project): string {
    const changed = card.isWaiting ? card.changedPlaces((file) => project.read(file)) : []

    return changed.length === 0
      ? card.oneLine()
      : `${card.oneLine()}  (changed since: ${changed.map((place) => PlaceText.write(place)).join(', ')})`
  }
}
