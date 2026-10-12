import { RepositorySessions, type Session } from '@weaver/engine'
import type { Output } from '../../output/output.ts'
import { Project } from '../../project/project.ts'
import type { Command } from '../line/command.ts'

const ON = 'on'
const OFF = 'off'
// With no session named, the one that worked here within this time is meant, when it is the only one.
const AT_WORK_MINUTES = 60
const LISTED = 8
const REQUEST_LENGTH = 60

// Maintenance is the owner lifting the guards of the project for one session of an agent. It lasts until they turn
// it off: nothing else does.
export class MaintenanceCommand implements Command {
  readonly name = 'maintenance'
  readonly usage = `maintenance ${ON}|${OFF} [<session>]`
  readonly summary = 'Lift the guards of the project for one session of an agent, or put them back: its work is still checked.'
  readonly ownerOnly = true
  private readonly cwd: string
  private readonly output: Output

  constructor(cwd: string, output: Output) {
    this.cwd = cwd
    this.output = output
  }

  run(args: readonly string[]): number {
    const [state, start, ...others] = args
    const sessions = new RepositorySessions(Project.locate(this.cwd).repository)

    if (others.length > 0 || (state !== undefined && state !== ON && state !== OFF)) {
      this.output.say(`weaver ${this.usage}`)

      return 2
    }

    if (state === undefined) return this.standing(sessions)

    return state === ON ? this.turnOn(sessions, start) : this.turnOff(sessions, start)
  }

  private standing(sessions: RepositorySessions): number {
    const held = sessions.underMaintenance()

    this.output.say(held.length === 0 ? 'No session is in maintenance.' : `${String(held.length)} session(s) in maintenance:`)
    this.list(held)
    this.output.say(`weaver ${this.usage}`)

    return 0
  }

  private turnOn(sessions: RepositorySessions, start: string | undefined): number {
    const session = start === undefined ? this.atWork(sessions) : this.named(sessions, start)

    if (session === null) return 1

    const described = this.described(session)

    if (!session.maintain(true)) {
      this.output.say(`The session ${session.shortId} was already in maintenance, since ${this.at(session.maintenance)}.`)

      return 0
    }

    this.output.say(`Maintenance is on for the session ${described}.`)
    this.output.say(
      "The guards of the project and the one on Weaver's configuration let its calls through. Its work is still checked, and each call a guard would have refused is listed for you when the task ends.",
    )
    this.output.say("Weaver's state, the hook settings of the agents and your own commands stay refused.")
    this.output.say(`Nothing turns it off but you: weaver maintenance ${OFF} ${session.shortId}`)

    return 0
  }

  // With no session named, every session in maintenance leaves it: putting guards back is never the wrong session.
  private turnOff(sessions: RepositorySessions, start: string | undefined): number {
    if (start === undefined) return this.putBack(sessions.underMaintenance())

    const session = this.named(sessions, start)

    return session === null ? 1 : this.putBack([session])
  }

  private putBack(held: readonly Session[]): number {
    if (held.length === 0) this.output.say('No session is in maintenance.')

    for (const session of held) {
      this.output.say(
        session.maintain(false)
          ? `Maintenance is off for the session ${session.shortId}: the guards refuse its calls again.`
          : `The session ${session.shortId} was not in maintenance.`,
      )
    }

    return 0
  }

  // null when the characters name no session or several, which is said with the sessions to choose from.
  private named(sessions: RepositorySessions, start: string): Session | null {
    const matches = sessions.startingWith(start)
    const [session] = matches

    if (session !== undefined && matches.length === 1) return session

    this.output.say(
      session === undefined
        ? `No session starts with "${start}".`
        : `${String(matches.length)} sessions start with "${start}": give more of its characters.`,
    )
    this.list(session === undefined ? sessions.all() : matches)

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
      this.output.say('No session is known here: a session is known from its first request on.')

      return null
    }

    this.output.say(
      `${session === undefined ? 'No session' : `${String(recent.length)} sessions`} worked here in the last ${String(AT_WORK_MINUTES)} minutes: name the one to put in maintenance, by the first characters of its id.`,
    )
    this.list(session === undefined ? known : recent)

    return null
  }

  private list(sessions: readonly Session[]): void {
    for (const session of sessions.slice(0, LISTED)) this.output.say(`  ${this.described(session)}`)
    if (sessions.length > LISTED) this.output.say(`  and ${String(sessions.length - LISTED)} seen before these`)
  }

  // What tells a session from another for its owner: who runs it, when it last worked, what it was last asked.
  private described(session: Session): string {
    const request = session.lastRequest?.trim().split('\n')[0] ?? ''
    const asked = request.length > REQUEST_LENGTH ? `${request.slice(0, REQUEST_LENGTH)}…` : request
    const since = session.maintenance

    return [
      session.shortId,
      session.agent,
      `last seen ${this.at(session.seenAt)}`,
      ...(asked === '' ? [] : [`asked "${asked}"`]),
      ...(since === null ? [] : [`in maintenance since ${this.at(since)}`]),
    ].join(', ')
  }

  private at(moment: Date | string | null): string {
    if (moment === null) return 'an unknown time'

    const date = new Date(moment)
    const two = (value: number): string => String(value).padStart(2, '0')

    return `${String(date.getFullYear())}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
  }
}
