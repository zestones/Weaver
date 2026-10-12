import { Journal } from '@weaver/engine'
import type { CardState } from '@weaver/memory'
import { CardNumbers, type CardFigures } from '../../numbers/card-numbers.ts'
import { JournalNumbers } from '../../numbers/journal-numbers.ts'
import { LocalDay } from '../../numbers/local-day.ts'
import { Period } from '../../numbers/period.ts'
import { StatsPage, type ProjectFigures } from '../../numbers/stats-page.ts'
import type { Output } from '../../output/output.ts'
import { Project } from '../../project/project.ts'
import type { Command } from '../line/command.ts'

const SINCE = '--since'
const AS_JSON = '--json'
const EVERY_STATE: readonly CardState[] = ['raw', 'open', 'closed', 'merged']

// Weaver keeps what it does in a journal, and what agents discover in a registry. This counts both, and leaves what
// the numbers mean to whoever reads them.
export class StatsCommand implements Command {
  readonly name = 'stats'
  readonly usage = `stats [${SINCE} <day>|<n>d] [${AS_JSON}]`
  readonly summary = 'Count what Weaver kept of its work in this project: times, verdicts, warnings, reviews, cards.'
  readonly ownerOnly = false
  private readonly cwd: string
  private readonly output: Output

  constructor(cwd: string, output: Output) {
    this.cwd = cwd
    this.output = output
  }

  run(args: readonly string[]): number {
    const words = args.filter((arg) => arg !== AS_JSON)
    const [option, since, ...others] = words
    const period = option === undefined ? Period.whole() : option === SINCE && others.length === 0 ? Period.from(since ?? '') : null

    if (period === null) {
      this.output.say(`weaver ${this.usage}`)
      this.output.say(`  ${SINCE} takes a day, as 2026-10-01, or a number of days back from now, as 7d.`)

      return 2
    }

    const project = Project.locate(this.cwd)
    const journal = new Journal(project.repository)
    const figures: ProjectFigures = {
      since: period.since === null ? null : new LocalDay(period.since).text,
      journal: new JournalNumbers(journal.read().filter((event) => period.holds(event.at))).figures,
      cards: this.cards(project, period),
    }

    if (args.includes(AS_JSON)) this.output.say(JSON.stringify(figures, null, 2))
    else for (const line of new StatsPage(figures, journal.dir).lines()) this.output.say(line)

    return 0
  }

  private cards(project: Project, period: Period): CardFigures | null {
    const registry = project.recordedRegistry()

    if (registry === null) return null

    try {
      return new CardNumbers(registry.list({ states: EVERY_STATE }), period).figures
    } finally {
      registry.close()
    }
  }
}
