import { JournalHistory, type Repository } from '@weaver/engine'
import { Counted } from '../output/counted.ts'

export class HookErrors {
  private readonly history: JournalHistory

  constructor(repo: Repository) {
    this.history = new JournalHistory(repo)
  }

  lines(): string[] {
    const errors = this.history.recentErrors()
    const latest = errors.at(-1)

    if (latest === undefined) return []

    const sessions = new Set(errors.map((event) => event.session).filter((session) => session !== null))

    return [
      `${new Counted(errors.length, 'hook error').text} in the last 7 days, across ${new Counted(sessions.size, 'session').text}. Latest: ${latest.at}, ${latest.event}: ${latest.message.replace(/\s+/g, ' ').slice(0, 200)}`,
      `Journal: ${this.history.journal.dir}. Run weaver doctor.`,
    ]
  }
}
