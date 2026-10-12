import { DetachedWriterLauncher, type WriterLauncher } from '@weaver/memory'
import { Payload } from '../../agents/events/payload.ts'
import { AgentCatalog } from '../../agents/runtimes/agent-catalog.ts'
import type { CheckRunner } from '../../checks/running/check-runner.ts'
import { ProjectChecks } from '../../checks/running/project-checks.ts'
import type { Declaration } from '../../declaration/content/declaration.ts'
import { DeclarationError } from '../../declaration/reading/declaration-error.ts'
import { DeclarationFolder } from '../../declaration/reading/declaration-folder.ts'
import { Repository } from '../../lib/git/repository.ts'
import { DetachedLauncher } from '../../review/launching/detached-launcher.ts'
import type { ReviewLauncher } from '../../review/launching/review-launcher.ts'
import { ReviewRounds } from '../../review/rounds/review-rounds.ts'
import type { EventBody, EventSource } from '../../unit-of-work/journal/journal-event.ts'
import { Journal } from '../../unit-of-work/journal/journal.ts'
import { Answer } from '../exchange/answer.ts'
import { Turn } from '../exchange/turn.ts'
import { AfterCall } from '../moments/after-call.ts'
import { BeforeCall } from '../moments/before-call.ts'
import { EndOfTurn } from '../moments/end-of-turn.ts'
import type { Moment } from '../moments/moment.ts'
import { OnRequest } from '../moments/on-request.ts'

export class Loop {
  private readonly agents = new AgentCatalog()
  private readonly moments: ReadonlyMap<string, Moment>
  private readonly sinceStart: () => number

  // `sinceStart` gives the milliseconds since the process of the hook started: what a run of it took.
  constructor(
    checks: CheckRunner = new ProjectChecks(),
    launcher: ReviewLauncher = new DetachedLauncher(),
    writers: WriterLauncher = new DetachedWriterLauncher(),
    sinceStart: () => number = () => Math.round(performance.now()),
  ) {
    this.sinceStart = sinceStart
    this.moments = new Map<string, Moment>([
      ['UserPromptSubmit', new OnRequest()],
      ['PreToolUse', new BeforeCall()],
      ['PostToolUse', new AfterCall('PostToolUse', checks)],
      // A command that fails may have written files before it did.
      ['PostToolUseFailure', new AfterCall('PostToolUseFailure', checks)],
      ['Stop', new EndOfTurn(checks, new ReviewRounds(launcher), writers)],
    ])
  }

  handles(eventName: string): boolean {
    return this.moments.has(eventName)
  }

  async handle(eventName: string, argv: readonly string[], stdin: string): Promise<Answer> {
    const agent = this.agents.fromArguments(argv)
    const event = agent.read(Payload.parse(stdin))
    const moment = this.moments.get(eventName)
    const repo = Repository.locate(event.cwd)

    if (moment === undefined || repo === null) return Answer.silent()

    const declaration = this.declarationOf(repo)

    // A repository that declares nothing is not supervised, and nothing is kept of what happens there.
    if (declaration === null) return Answer.silent()

    const journal = new Journal(repo)
    const source = { session: event.sessionId, agent: agent.name }

    if (declaration instanceof DeclarationError) {
      this.keep(journal, source, { kind: 'error', event: eventName, message: declaration.message })

      return moment.speaksToOwner ? Answer.saying(`[weaver] Nothing is checked: ${declaration.message}`) : Answer.silent()
    }

    try {
      return await moment.run(new Turn(agent, event, repo, declaration))
    } catch (error) {
      this.keep(journal, source, { kind: 'error', event: eventName, message: error instanceof Error ? error.message : String(error) })

      throw error
    } finally {
      const run = { event: eventName, tool: event.call?.name ?? null, subagent: event.agentId, ms: this.sinceStart() }

      this.keep(journal, source, { kind: 'hook', ...run })
    }
  }

  // The journal is a record: failing to write a line of it never changes what the hook answers.
  private keep(journal: Journal, source: EventSource, body: EventBody): void {
    try {
      journal.append(source, body)
    } catch {
      return
    }
  }

  private declarationOf(repo: Repository): Declaration | DeclarationError | null {
    try {
      return DeclarationFolder.in(repo.top).load()
    } catch (error) {
      if (error instanceof DeclarationError) return error

      throw error
    }
  }
}
