import type { Session } from '../../unit-of-work/session/session.ts'

// What is said of a session the owner put in maintenance: to its agent with each request, to its owner once the
// task is over. Nothing closes maintenance but the owner.
export class MaintenanceNotice {
  readonly briefing: string | null
  readonly reminder: string | null

  constructor(session: Session | null) {
    const on = session !== null && session.maintenance !== null

    this.briefing = on
      ? "[weaver] The owner put this session in maintenance: the guards of the project and the one on Weaver's configuration let your calls through. Each call they would have refused is listed for the owner when the task ends, and your work is checked as usual. Weaver's state, the hook settings of the agents and the owner's commands stay refused."
      : null
    this.reminder = on
      ? `[weaver] This task is over and the session is still in maintenance: \`weaver maintenance off ${session.shortId}\` puts the guards back.`
      : null
  }
}
