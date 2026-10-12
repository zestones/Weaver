import { RepositorySessions, type Session } from '@weaver/engine'
import { Counted } from '../../output/counted.ts'
import type { Output } from '../../output/output.ts'
import { Screen } from '../../output/screen.ts'
import { TextTable } from '../../output/text-table.ts'
import { Project } from '../../project/project.ts'
import type { Command } from '../line/command.ts'

const ON = 'on'
const OFF = 'off'
// With no session named, the one that worked here within this time is meant, when it is the only one.
const AT_WORK_MINUTES = 60
const LISTED = 8
const REQUEST_LENGTH = 60
const NOT_IN_MAINTENANCE = '-'

// Maintenance is the owner lifting the guards of the project for one session of an agent. It lasts until they turn
// it off: nothing else does.
export class MaintenanceCommand implements Command {
  readonly name = 'maintenance'
  readonly usage = `maintenance [${ON}|${OFF}] [<session>]`
  readonly summary = 'Lift the guards for one session, or put them back'
  readonly ownerOnly = true
  readonly help = {
    group: 'Supervision',
    description:
      'Lift the guards of the project for one session of an agent, or put them back: its work is still checked. Without a word, say which sessions are in maintenance.',
    words: [
      [`${ON}|${OFF}`, 'Lift the guards, or put them back'],
      [
        '[<session>]',
        `The session, by the first characters of its id. Without it, ${ON} takes the one session at work, and ${OFF} every session in maintenance`,
      ],
    ],
    examples: ['weaver maintenance on', 'weaver maintenance on 3f2a', 'weaver maintenance off', 'weaver maintenance'],
  } as const
  private readonly cwd: string
  private readonly screen: Screen

  constructor(cwd: string, output: Output) {
    this.cwd = cwd
    this.screen = new Screen(output)
  }

  run(args: readonly string[]): number {
    const [state, start, ...others] = args
    const sessions = new RepositorySessions(Project.locate(this.cwd).repository)

    if (others.length > 0 || (state !== undefined && state !== ON && state !== OFF)) {
      this.screen.misuse(this.name, this.usage)

      return 2
    }

    if (state === undefined) return this.standing(sessions)

    return state === ON ? this.turnOn(sessions, start) : this.turnOff(sessions, start)
  }

  private standing(sessions: RepositorySessions): number {
    const held = sessions.underMaintenance()

    if (held.length === 0) {
      this.screen.line('No session is in maintenance.')

      return 0
    }

    this.screen.line(this.screen.bold(`${new Counted(held.length, 'session').text} in maintenance`))
    this.listed(held)
    this.screen.line()
    this.screen.hint(`Put the guards back with weaver maintenance ${OFF} [<session>].`)

    return 0
  }

  private turnOn(sessions: RepositorySessions, start: string | undefined): number {
    const session = start === undefined ? this.atWork(sessions) : this.named(sessions, start)

    if (session === null) return 1

    const seen = this.at(session.seenAt)

    if (!session.maintain(true)) {
      this.screen.note(`The session ${session.shortId} was already in maintenance, since ${this.at(session.maintenance)}.`)

      return 0
    }

    this.screen.done(`Maintenance is on for the session ${session.shortId} (${session.agent}, last seen ${seen}).`)
    this.screen.hint("The guards of the project and the one on Weaver's configuration let its calls through.", 1)
    this.screen.hint('Its work is still checked, and each call a guard would have refused is listed for you when the task ends.', 1)
    this.screen.hint("Weaver's state, the hook settings of the agents and your own commands stay refused.", 1)
    this.screen.line()
    this.screen.line(`Nothing turns it off but you: ${this.screen.command(`weaver maintenance ${OFF} ${session.shortId}`)}`)

    return 0
  }

  // With no session named, every session in maintenance leaves it: putting guards back is never the wrong session.
  private turnOff(sessions: RepositorySessions, start: string | undefined): number {
    if (start === undefined) return this.putBack(sessions.underMaintenance())

    const session = this.named(sessions, start)

    return session === null ? 1 : this.putBack([session])
  }

  private putBack(held: readonly Session[]): number {
    if (held.length === 0) this.screen.line('No session is in maintenance.')

    for (const session of held) {
      if (session.maintain(false))
        this.screen.done(`Maintenance is off for the session ${session.shortId}: the guards refuse its calls again.`)
      else this.screen.note(`The session ${session.shortId} was not in maintenance.`)
    }

    return 0
  }

  // null when the characters name no session or several, which is said with the sessions to choose from.
  private named(sessions: RepositorySessions, start: string): Session | null {
    const matches = sessions.startingWith(start)
    const [session] = matches

    if (session !== undefined && matches.length === 1) return session

    if (session === undefined) this.screen.error(`No session starts with "${start}".`)
    else this.screen.error(`${String(matches.length)} sessions start with "${start}".`, 'Give more of its characters.')

    this.listed(session === undefined ? sessions.all() : matches)

    return null
  }

  // null when no session worked here lately, or several: one is never guessed among them.
  private atWork(sessions: RepositorySessions): Session | null {
    const known = sessions.all()
    const since = Date.now() - AT_WORK_MINUTES * 60_000
    const recent = known.filter((session) => (session.seenAt?.getTime() ?? 0) >= since)
    const [session] = recent

    if (session !== undefined && recent.length === 1) return session

    if (known.length === 0) {
      this.screen.error('No session is known here.', 'A session is known from its first request on.')

      return null
    }

    const worked = session === undefined ? 'No session' : `${String(recent.length)} sessions`

    this.screen.error(
      `${worked} worked here in the last ${String(AT_WORK_MINUTES)} minutes.`,
      'Name the one to put in maintenance, by the first characters of its id.',
    )
    this.listed(session === undefined ? known : recent)

    return null
  }

  // What tells a session from another for its owner: who runs it, when it last worked, what it was last asked.
  private listed(sessions: readonly Session[]): void {
    const table = new TextTable(
      ['session', 'runtime', 'last seen', 'in maintenance since', 'last asked'],
      ['runtime', 'last seen', 'in maintenance since', 'last asked'],
    )

    for (const session of sessions.slice(0, LISTED)) {
      const since = session.maintenance

      table.add([
        session.shortId,
        session.agent,
        this.at(session.seenAt),
        since === null ? NOT_IN_MAINTENANCE : this.at(since),
        this.asked(session),
      ])
    }

    this.screen.line()
    this.screen.table(table)
    if (sessions.length > LISTED) this.screen.hint(`and ${String(sessions.length - LISTED)} seen before these`, 1)
  }

  private asked(session: Session): string {
    const request = session.lastRequest?.trim().split('\n')[0] ?? ''

    return request.length > REQUEST_LENGTH ? `${request.slice(0, REQUEST_LENGTH)}…` : request
  }

  private at(moment: Date | string | null): string {
    if (moment === null) return 'an unknown time'

    const date = new Date(moment)
    const two = (value: number): string => String(value).padStart(2, '0')

    return `${String(date.getFullYear())}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
  }
}
