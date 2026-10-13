import type { Screen } from '../output/screen.ts'
import { TextTable } from '../output/text-table.ts'
import type { CardFigures } from './card-numbers.ts'
import type { DistributionNumbers } from './distribution.ts'
import type { JournalFigures } from './journal-numbers.ts'
import { LocalDay } from './local-day.ts'

// What `weaver stats` counts, as a program reads it.
export interface ProjectFigures {
  // The day the count starts from; null when everything that was kept is counted.
  readonly since: string | null
  readonly journal: JournalFigures
  // null while the project has no registry of cards.
  readonly cards: CardFigures | null
}

const LABEL_WIDTH = 24
const NOT_MEASURED = '-'

// What the page is made of: a line, or a table under its title.
type Block = string | { readonly title: string; readonly table: TextTable }
const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS

// The figures as their owner reads them in a terminal. It states what was kept and concludes nothing.
export class StatsPage {
  private readonly figures: ProjectFigures
  private readonly journalDir: string

  constructor(figures: ProjectFigures, journalDir: string) {
    this.figures = figures
    this.journalDir = journalDir
  }

  print(screen: Screen): void {
    for (const block of this.blocks()) {
      if (typeof block === 'string') {
        screen.line(block)
      } else {
        screen.heading(block.title)
        screen.table(block.table)
      }
    }
  }

  private blocks(): Block[] {
    const { journal, since } = this.figures

    if (journal.lines === 0) {
      return [`Weaver kept nothing of this project${since === null ? ' yet' : ` since ${since}`}: its journal has no line to count.`]
    }

    return [
      `Weaver in this project, from ${this.day(journal.from)} to ${this.day(journal.to)}: ${String(journal.lines)} lines of its journal.`,
      '',
      ...this.activity(),
      ...this.verdicts(),
      ...this.checks(),
      ...this.warnings(),
      ...this.hooks(),
      ...this.guards(),
      ...this.reviews(),
      ...this.memory(),
      '',
      this.row("Weaver's own errors", this.withDetail(journal.errors.total, journal.errors.byEvent)),
      this.row('Lines by Weaver', this.listed(journal.byWeaver)),
      '',
      `The lines themselves are in ${this.journalDir}, one file for each session.`,
    ]
  }

  private activity(): Block[] {
    const { sessions, requests, calls, turns } = this.figures.journal
    const held = `held by the checks ${String(turns.heldByChecks)}, by a review ${String(turns.heldByReview)}, by the reminder ${String(turns.heldByReminder)}`

    return [
      this.row('Sessions', this.withDetail(sessions.total, sessions.byAgent)),
      this.row('Requests', this.withDetail(requests.total, requests.directives)),
      this.row('Calls', `${String(calls.changingFiles)} changed files, ${String(calls.movingHead)} moved HEAD`),
      this.row('Ends of turn', `${String(turns.total)}: the agent said it had finished ${String(turns.finished)}; ${held}`),
    ]
  }

  private verdicts(): Block[] {
    const { verdicts, units } = this.figures.journal

    const settled = this.row(
      'Units of work settled',
      `${String(units.settled)}: ${String(units.byVerdict)} by a verdict, ${String(units.withNoFile)} with no file to judge, ${String(units.byOwner)} by the owner`,
    )

    // A series nobody measured has no median to show.
    if (verdicts.total === 0) return [this.row('Verdicts', '0'), settled]

    return [
      this.row('Verdicts', `${String(verdicts.total)}: ${String(verdicts.passed)} passed, ${String(verdicts.failed)} failed`),
      this.row('  time', `${this.spread(verdicts.ms)}, ${this.span(verdicts.ms.total)} in all`),
      this.row('  files changed', this.sizes(verdicts.files)),
      this.row('  lines added', this.sizes(verdicts.lines)),
      this.row('  files a repair rewrote', String(verdicts.repaired)),
      this.row('  items to validate', String(verdicts.toValidate)),
      settled,
    ]
  }

  private checks(): Block[] {
    const table = new TextTable([
      'check',
      'ran',
      'passed',
      'failed',
      'out of time',
      'skipped',
      'findings',
      'for the owner',
      'for a reviewer',
      'median',
      'nine in ten',
      'longest',
    ])

    for (const [id, check] of Object.entries(this.figures.journal.checks)) {
      const counts = [
        check.ran,
        check.passed,
        check.failed,
        check.timedOut,
        check.skipped,
        check.failures,
        check.toValidate,
        check.candidates,
      ]

      table.add([id, ...counts, ...this.times(check.ms)])
    }

    return this.section('Checks at the end of a task', table)
  }

  private warnings(): Block[] {
    const { warnings } = this.figures.journal
    const table = new TextTable(['check', 'ran', 'warned', 'out of time', 'median', 'nine in ten', 'longest'])

    for (const [id, check] of Object.entries(warnings.checks))
      table.add([id, check.ran, check.warned, check.timedOut, ...this.times(check.ms)])

    return this.section(`Warnings right after a call: ${String(warnings.calls)} calls, ${this.spread(warnings.ms)}`, table)
  }

  private hooks(): Block[] {
    const table = new TextTable(['event', 'runs', 'median', 'nine in ten', 'longest', 'in all'])

    for (const [event, ms] of Object.entries(this.figures.journal.hooks))
      table.add([event, ms.count, ...this.times(ms), this.span(ms.total)])

    return this.section('Runs of the hook', table)
  }

  private guards(): Block[] {
    const { guards, maintenance } = this.figures.journal
    const table = new TextTable(['guard', 'refused', 'let through in maintenance'])

    for (const [guard, calls] of Object.entries(guards)) table.add([guard, calls.refused, calls.lifted])

    return [
      ...this.section('Guards', table),
      '',
      this.row('Maintenance', `turned on ${String(maintenance.turnedOn)}, off ${String(maintenance.turnedOff)}`),
    ]
  }

  private reviews(): Block[] {
    const { byReviewer, answers, byRule } = this.figures.journal.reviews
    const ended = 'how they ended'
    const reviewers = new TextTable(
      ['reviewer', 'reviews', 'rules given', 'findings', 'suspicions', 'dropped', 'experiments', 'median', 'longest', 'cost', ended],
      [ended],
    )
    const rules = new TextTable(['rule', 'findings', 'fixed', 'not fixed', 'no answer'])

    for (const [name, reviewer] of Object.entries(byReviewer)) {
      const counts = [reviewer.reviews, reviewer.rules, reviewer.findings, reviewer.suspicions, reviewer.dropped, reviewer.experiments]
      const [median = NOT_MEASURED, , longest = NOT_MEASURED] = this.times(this.inMs(reviewer.seconds))
      const times = [median, longest]

      reviewers.add([name, ...counts, ...times, `$${reviewer.costUsd.toFixed(2)}`, this.listed(reviewer.byStanding)])
    }

    for (const [rule, found] of Object.entries(byRule)) rules.add([rule, found.findings, found.fixed, found.notFixed, found.missing])

    if (reviewers.isEmpty) return ['', this.row('Reviews', '0')]

    return [
      ...this.section('Reviews', reviewers),
      '',
      this.row(
        'Answers to findings',
        `fixed ${String(answers.fixed)}, not fixed ${String(answers.notFixed)}, no answer ${String(answers.missing)}`,
      ),
      ...this.section('Findings by rule', rules),
    ]
  }

  private memory(): Block[] {
    const { flags } = this.figures.journal
    const { cards } = this.figures
    const made = this.row('Flags', `made ${String(flags.made)}, already known ${String(flags.alreadyKnown)}`)

    if (cards === null) return ['', made, this.row('Cards', '0')]

    const { opened, closed, waiting } = cards
    const oldest = waiting.oldestAt === null ? '' : `, the oldest since ${this.day(waiting.oldestAt)}`

    return [
      '',
      made,
      this.row('Cards opened', this.withDetail(opened.total, opened.byOrigin)),
      this.row('Cards written', `${String(cards.written)}; writings that failed ${String(cards.writingFailed)}`),
      this.row('Notes on cards', this.withDetail(cards.notes.total, cards.notes.byConclusion)),
      this.row('Cards closed', this.withDetail(closed.total, closed.byClosing)),
      this.row('Cards waiting now', `${String(waiting.total)}; not written yet ${String(waiting.notWritten)}${oldest}`),
    ]
  }

  // Nothing is said of what never happened: an empty table would only be its headings.
  private section(title: string, table: TextTable): Block[] {
    return table.isEmpty ? [] : [{ title, table }]
  }

  private row(label: string, text: string): string {
    return `${label.padEnd(LABEL_WIDTH)}  ${text}`
  }

  private withDetail(total: number, counts: Readonly<Record<string, number>>): string {
    const detail = this.listed(counts)

    return detail === '' ? String(total) : `${String(total)} (${detail})`
  }

  private listed(counts: Readonly<Record<string, number>>): string {
    return Object.entries(counts)
      .map(([name, count]) => `${name} ${String(count)}`)
      .join(', ')
  }

  // A series nobody measured has no time to show: a nought would read as a time that was nothing.
  private times(ms: DistributionNumbers): string[] {
    return ms.count === 0
      ? [NOT_MEASURED, NOT_MEASURED, NOT_MEASURED]
      : [this.seconds(ms.median), this.seconds(ms.ninthDecile), this.seconds(ms.largest)]
  }

  private sizes(of: DistributionNumbers): string {
    return of.count === 0
      ? 'not measured by the Weaver that kept these verdicts'
      : `median ${String(of.median)}, largest ${String(of.largest)}`
  }

  private inMs(seconds: DistributionNumbers): DistributionNumbers {
    const { count, median, ninthDecile, largest, total } = seconds

    return {
      count,
      median: median * SECOND_MS,
      ninthDecile: ninthDecile * SECOND_MS,
      largest: largest * SECOND_MS,
      total: total * SECOND_MS,
    }
  }

  private spread(ms: DistributionNumbers): string {
    return `median ${this.seconds(ms.median)}, nine in ten within ${this.seconds(ms.ninthDecile)}, longest ${this.seconds(ms.largest)}`
  }

  // A time as it is compared with another: always in seconds, with the digits that tell two of them apart.
  private seconds(ms: number): string {
    const seconds = ms / SECOND_MS

    if (seconds < 10) return `${seconds.toFixed(2)} s`

    return `${seconds.toFixed(seconds < 100 ? 1 : 0)} s`
  }

  // A time added up, in the unit it is easiest to read in.
  private span(ms: number): string {
    if (ms >= HOUR_MS) return `${(ms / HOUR_MS).toFixed(1)} h`

    return ms >= MINUTE_MS ? `${(ms / MINUTE_MS).toFixed(1)} min` : this.seconds(ms)
  }

  private day(at: string | null): string {
    return at === null ? 'nothing' : new LocalDay(new Date(at)).text
  }
}
