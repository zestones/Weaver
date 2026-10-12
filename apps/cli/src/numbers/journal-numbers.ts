import type { CheckRun, EventOf, JournalEvent } from '@weaver/engine'
import { Distribution, type DistributionNumbers } from './distribution.ts'

type Counts = Readonly<Record<string, number>>

interface CheckFigures {
  readonly ran: number
  readonly passed: number
  readonly failed: number
  readonly timedOut: number
  readonly skipped: number
  // The findings its runs gave: those that hold a task, those that wait for the owner, those listed for a reviewer.
  readonly failures: number
  readonly toValidate: number
  readonly candidates: number
  readonly ms: DistributionNumbers
}

interface WarningFigures {
  readonly ran: number
  readonly warned: number
  readonly timedOut: number
  readonly ms: DistributionNumbers
}

export interface ReviewerFigures {
  readonly reviews: number
  readonly byStanding: Counts
  readonly rules: number
  readonly findings: number
  readonly suspicions: number
  readonly dropped: number
  readonly experiments: number
  readonly seconds: DistributionNumbers
  // The cost of the reviews that said theirs.
  readonly costUsd: number
}

interface RuleFigures {
  readonly findings: number
  readonly fixed: number
  readonly notFixed: number
  readonly missing: number
}

// What the journal of a project holds, counted. Nothing here is a judgement: these are the numbers as they were kept.
export interface JournalFigures {
  readonly from: string | null
  readonly to: string | null
  readonly lines: number
  readonly byWeaver: Counts
  readonly sessions: { readonly total: number; readonly byAgent: Counts }
  readonly requests: { readonly total: number; readonly directives: Counts }
  readonly turns: {
    readonly total: number
    readonly finished: number
    readonly heldByChecks: number
    readonly heldByReview: number
    readonly heldByReminder: number
  }
  // One verdict is one run of the checks at the end of a task.
  readonly verdicts: {
    readonly total: number
    readonly passed: number
    readonly failed: number
    readonly toValidate: number
    readonly repaired: number
    readonly ms: DistributionNumbers
    readonly files: DistributionNumbers
    readonly lines: DistributionNumbers
  }
  // A unit of work ends after a verdict that passed, with no file left to judge, or by the owner's own commit.
  readonly units: { readonly settled: number; readonly byVerdict: number; readonly withNoFile: number; readonly byOwner: number }
  readonly checks: Readonly<Record<string, CheckFigures>>
  readonly warnings: { readonly calls: number; readonly ms: DistributionNumbers; readonly checks: Readonly<Record<string, WarningFigures>> }
  readonly hooks: Readonly<Record<string, DistributionNumbers>>
  readonly calls: { readonly changingFiles: number; readonly movingHead: number }
  readonly guards: Readonly<Record<string, { readonly refused: number; readonly lifted: number }>>
  readonly maintenance: { readonly turnedOn: number; readonly turnedOff: number }
  readonly reviews: {
    readonly byReviewer: Readonly<Record<string, ReviewerFigures>>
    readonly answers: { readonly fixed: number; readonly notFixed: number; readonly missing: number }
    readonly byRule: Readonly<Record<string, RuleFigures>>
  }
  readonly flags: { readonly made: number; readonly alreadyKnown: number }
  readonly errors: { readonly total: number; readonly byEvent: Counts }
}

const NO_REVIEWER = 'no reviewer'
// The lines a unit of work added are kept since this shape of the journal: an earlier verdict did not measure them.
const LINES_KEPT_SINCE = 2

export class JournalNumbers {
  private readonly events: readonly JournalEvent[]

  // The events in the order they were written.
  constructor(events: readonly JournalEvent[]) {
    this.events = events
  }

  get figures(): JournalFigures {
    const errors = this.of('error')
    const settles = this.of('settle')

    return {
      from: this.events[0]?.at ?? null,
      to: this.events.at(-1)?.at ?? null,
      lines: this.events.length,
      byWeaver: this.counted(this.events.map((event) => event.weaver)),
      sessions: this.sessions(),
      requests: {
        total: this.of('request').length,
        directives: this.counted(this.of('request').flatMap((request) => request.directives)),
      },
      turns: this.turns(),
      verdicts: this.verdicts(),
      units: {
        settled: settles.length,
        byVerdict: settles.filter((settle) => settle.by === 'check' && settle.files > 0).length,
        withNoFile: settles.filter((settle) => settle.by === 'check' && settle.files === 0).length,
        byOwner: settles.filter((settle) => settle.by === 'owner').length,
      },
      checks: this.checks(),
      warnings: this.warnings(),
      hooks: this.grouped(
        this.of('hook'),
        (hook) => hook.event,
        (hooks) => this.spread(hooks.map((hook) => hook.ms)),
      ),
      calls: { changingFiles: this.of('touch').length, movingHead: this.of('head-moved').length },
      guards: this.guards(),
      maintenance: {
        turnedOn: this.of('maintenance').filter((change) => change.on).length,
        turnedOff: this.of('maintenance').filter((change) => !change.on).length,
      },
      reviews: this.reviews(),
      flags: { made: this.of('flag').length, alreadyKnown: this.of('flag').filter((flag) => flag.known).length },
      errors: { total: errors.length, byEvent: this.counted(errors.map((error) => error.event)) },
    }
  }

  private sessions(): JournalFigures['sessions'] {
    const agents = new Map<string, string>()

    for (const { session, agent } of this.events) if (session !== null && !agents.has(session)) agents.set(session, agent ?? 'unknown')

    return { total: agents.size, byAgent: this.counted([...agents.values()]) }
  }

  private turns(): JournalFigures['turns'] {
    const turns = this.of('turn')
    const held = (by: EventOf<'turn'>['held']): number => turns.filter((turn) => turn.held === by).length

    return {
      total: turns.length,
      finished: turns.filter((turn) => turn.finished).length,
      heldByChecks: held('checks'),
      heldByReview: held('review'),
      heldByReminder: held('reminder'),
    }
  }

  private verdicts(): JournalFigures['verdicts'] {
    const verdicts = this.of('check')

    return {
      total: verdicts.length,
      passed: verdicts.filter((verdict) => verdict.passed).length,
      failed: verdicts.filter((verdict) => !verdict.passed).length,
      toValidate: this.sum(verdicts.map((verdict) => verdict.toValidate)),
      repaired: this.sum(verdicts.map((verdict) => verdict.repaired)),
      ms: this.spread(verdicts.map((verdict) => verdict.ms)),
      files: this.spread(verdicts.map((verdict) => verdict.files)),
      lines: this.spread(verdicts.filter((verdict) => verdict.v >= LINES_KEPT_SINCE).map((verdict) => verdict.lines)),
    }
  }

  private checks(): JournalFigures['checks'] {
    const runs = this.of('check').flatMap((verdict) => verdict.checks)

    return this.grouped(
      runs,
      (run) => run.id,
      (of) => {
        const ran = of.filter((run) => run.status !== 'skip')

        return {
          ran: ran.length,
          passed: this.ended(of, 'pass'),
          failed: this.ended(of, 'fail'),
          timedOut: this.ended(of, 'timeout'),
          skipped: this.ended(of, 'skip'),
          failures: this.sum(of.map((run) => run.failures)),
          toValidate: this.sum(of.map((run) => run.toValidate)),
          candidates: this.sum(of.map((run) => run.candidates)),
          ms: this.spread(ran.map((run) => run.ms)),
        }
      },
    )
  }

  private warnings(): JournalFigures['warnings'] {
    const calls = this.of('warn')
    const runs = calls.flatMap((call) => call.checks.map((run) => ({ ...run, warned: call.warned.includes(run.id) })))

    return {
      calls: calls.length,
      ms: this.spread(calls.map((call) => call.ms)),
      checks: this.grouped(
        runs,
        (run) => run.id,
        (of) => ({
          ran: of.length,
          warned: of.filter((run) => run.warned).length,
          timedOut: this.ended(of, 'timeout'),
          ms: this.spread(of.map((run) => run.ms)),
        }),
      ),
    }
  }

  private guards(): JournalFigures['guards'] {
    const calls = [...this.of('refuse'), ...this.of('lift')]

    return this.grouped(
      calls,
      (call) => call.guard,
      (of) => ({ refused: of.filter((call) => call.kind === 'refuse').length, lifted: of.filter((call) => call.kind === 'lift').length }),
    )
  }

  private reviews(): JournalFigures['reviews'] {
    const reviews = this.of('review')
    const answers = this.of('answer')
    const answered = (status: EventOf<'answer'>['status'], among = answers): number =>
      among.filter((answer) => answer.status === status).length
    const rules = [...new Set([...reviews.flatMap((review) => review.findingRules), ...answers.map((answer) => answer.rule)])]

    return {
      byReviewer: this.grouped(
        reviews,
        (review) => (review.runtime === '' ? NO_REVIEWER : [review.runtime, ...(review.model === null ? [] : [review.model])].join(' ')),
        (of) => this.reviewer(of),
      ),
      answers: { fixed: answered('fixed'), notFixed: answered('not-fixed'), missing: answered('missing') },
      byRule: Object.fromEntries(
        rules.map((rule) => {
          const about = answers.filter((answer) => answer.rule === rule)
          const findings = reviews.flatMap((review) => review.findingRules).filter((found) => found === rule).length

          return [
            rule,
            { findings, fixed: answered('fixed', about), notFixed: answered('not-fixed', about), missing: answered('missing', about) },
          ]
        }),
      ),
    }
  }

  private reviewer(reviews: readonly EventOf<'review'>[]): ReviewerFigures {
    // A review that was skipped took no time, and one that still runs has not said how long it took.
    const timed = reviews.filter((review) => review.standing !== 'skipped' && review.standing !== 'running')

    return {
      reviews: reviews.length,
      byStanding: this.counted(reviews.map((review) => review.standing)),
      rules: this.sum(reviews.map((review) => review.rules)),
      findings: this.sum(reviews.map((review) => review.findings)),
      suspicions: this.sum(reviews.map((review) => review.suspicions)),
      dropped: this.sum(reviews.map((review) => review.dropped)),
      experiments: this.sum(reviews.map((review) => review.experiments)),
      seconds: this.spread(timed.map((review) => review.seconds)),
      costUsd: this.sum(reviews.map((review) => review.costUsd ?? 0)),
    }
  }

  private of<Kind extends JournalEvent['kind']>(kind: Kind): EventOf<Kind>[] {
    return this.events.filter((event): event is EventOf<Kind> => event.kind === kind)
  }

  private ended(runs: readonly CheckRun[], status: CheckRun['status']): number {
    return runs.filter((run) => run.status === status).length
  }

  private sum(values: readonly number[]): number {
    return values.reduce((total, value) => total + value, 0)
  }

  private spread(values: readonly number[]): DistributionNumbers {
    const distribution = new Distribution()

    for (const value of values) distribution.add(value)

    return distribution.numbers
  }

  private counted(words: readonly string[]): Record<string, number> {
    const counts: Record<string, number> = {}

    for (const word of words) counts[word] = (counts[word] ?? 0) + 1

    return counts
  }

  // The items that share a name, each group turned into its figures, in the order the names first came.
  private grouped<Item, Figures>(
    items: readonly Item[],
    name: (item: Item) => string,
    figures: (of: Item[]) => Figures,
  ): Record<string, Figures> {
    const groups = new Map<string, Item[]>()

    for (const item of items) groups.set(name(item), [...(groups.get(name(item)) ?? []), item])

    return Object.fromEntries([...groups].map(([key, of]) => [key, figures(of)]))
  }
}
