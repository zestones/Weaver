import { EndOfTaskProgress, RepositorySessions, type ProgressRecord, type Session } from '@weaver/engine'
import type { Output } from '../../output/output.ts'
import { Screen } from '../../output/screen.ts'
import { EndOfTaskPage } from '../../progress/end-of-task-page.ts'
import { Project } from '../../project/project.ts'
import type { Command } from '../line/command.ts'

const WATCH = '--watch'
const EVERY_MS = 1000

interface EndOfTask {
  readonly session: Session
  readonly record: ProgressRecord
}

// The end of a task can take long: its checks, then the review. This says where it is while the owner waits, and how
// the last one ended.
export class StatusCommand implements Command {
  readonly name = 'status'
  readonly usage = `status [${WATCH}]`
  readonly summary = 'Say where the end of a task is'
  readonly ownerOnly = false
  readonly help = {
    group: 'Supervision',
    description:
      'Say where the end of a task is while it runs: each check, how long it has run and how long it usually takes here, then the review. With none running, say how the last one ended.',
    words: [[WATCH, 'Draw it again every second, until Ctrl+C']],
    examples: ['weaver status', `weaver status ${WATCH}`],
  } as const
  private readonly cwd: string
  private readonly screen: Screen

  constructor(cwd: string, output: Output) {
    this.cwd = cwd
    this.screen = new Screen(output)
  }

  async run(args: readonly string[]): Promise<number> {
    if (args.some((arg) => arg !== WATCH)) {
      this.screen.misuse(this.name, this.usage)

      return 2
    }

    const sessions = new RepositorySessions(Project.locate(this.cwd).repository)

    // A program reads one answer: only a person at a terminal is drawn a watch.
    if (args.includes(WATCH) && this.screen.redraws) await this.watch(sessions)

    this.print(sessions, false)

    return 0
  }

  // Until the owner stops it; the screen is then theirs again, with where the end of the task was.
  private async watch(sessions: RepositorySessions): Promise<void> {
    await new Promise<void>((stopped) => {
      const draw = (): void => {
        this.screen.cleared()
        this.print(sessions, true)
      }
      const timer = setInterval(draw, EVERY_MS)

      process.once('SIGINT', () => {
        clearInterval(timer)
        stopped()
      })
      draw()
    })
    this.screen.givenBack()
  }

  // The ends of task running now, or the last one when none runs.
  private print(sessions: RepositorySessions, watching: boolean): void {
    const now = Date.now()
    const ends = this.endsOfTask(sessions)
    const running = ends.filter(({ record }) => record.endedAt === null && !EndOfTaskProgress.isCut(record))
    const shown = running.length > 0 ? running : ends.slice(0, 1)

    if (shown.length === 0) this.screen.line('No end of task has run here yet.')

    shown.forEach(({ session, record }, index) => {
      if (index > 0) this.screen.line()
      new EndOfTaskPage(session, record, now).print(this.screen)
    })

    this.screen.line()
    if (watching) this.screen.hint(running.length === 0 ? 'The next end of task shows here. Ctrl+C stops.' : 'Ctrl+C stops.')
    else if (running.length > 0) this.screen.hint(`Follow it with ${this.screen.command(`weaver status ${WATCH}`)}.`)
  }

  private endsOfTask(sessions: RepositorySessions): EndOfTask[] {
    return sessions
      .all()
      .flatMap((session) => {
        const record = EndOfTaskProgress.read(session.dir)

        return record === null ? [] : [{ session, record }]
      })
      .sort((one, other) => Date.parse(other.record.startedAt) - Date.parse(one.record.startedAt))
  }
}
