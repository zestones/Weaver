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

  constructor(checks: CheckRunner = new ProjectChecks(), launcher: ReviewLauncher = new DetachedLauncher()) {
    const afterCall = new AfterCall()

    this.moments = new Map<string, Moment>([
      ['UserPromptSubmit', new OnRequest()],
      ['PreToolUse', new BeforeCall()],
      ['PostToolUse', afterCall],
      // A command that fails may have written files before it did.
      ['PostToolUseFailure', afterCall],
      ['Stop', new EndOfTurn(checks, new ReviewRounds(launcher))],
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

    if (declaration instanceof DeclarationError) {
      return moment.speaksToOwner ? Answer.saying(`[weaver] Nothing is checked: ${declaration.message}`) : Answer.silent()
    }

    // A repository that declares nothing is not supervised.
    return declaration === null ? Answer.silent() : moment.run(new Turn(agent, event, repo, declaration))
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
