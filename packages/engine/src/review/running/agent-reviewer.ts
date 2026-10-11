import { setTimeout as sleep } from 'node:timers/promises'
import { AgentTask, ExecutionCatalog, type AgentExecution, type AgentResult } from '@weaver/agent-sdk'
import type { Repository } from '../../lib/git/repository.ts'
import { AnswerReader } from '../findings/answer-reader.ts'
import type { ReviewRequest } from '../request/review-request.ts'
import { ReviewOutcome } from '../results/review-outcome.ts'
import type { ReviewAssignment } from '../routing/review-routing.ts'
import { ReviewCopy } from '../workspace/review-copy.ts'
import type { Reviewer } from './reviewer.ts'

export interface ReviewerSetup {
  // The program a reviewer that writes is held by: this one, which is running as a hook of the author.
  readonly hook?: string
  readonly copies?: string
  readonly retryAfterMs?: number
}

const RETRY_AFTER_MS = 60_000

export class AgentReviewer implements Reviewer {
  // A reviewer started by Weaver is not supervised by Weaver, and must not review itself.
  static readonly MARK = 'WEAVER_REVIEWER'

  private readonly catalog: ExecutionCatalog
  private readonly hook: string
  private readonly copies: string
  private readonly retryAfterMs: number

  constructor(catalog: ExecutionCatalog = new ExecutionCatalog(), setup: ReviewerSetup = {}) {
    this.catalog = catalog
    this.hook = setup.hook ?? process.argv[1] ?? ''
    this.copies = setup.copies ?? ReviewCopy.root()
    this.retryAfterMs = setup.retryAfterMs ?? RETRY_AFTER_MS
  }

  async review(request: ReviewRequest, assignment: ReviewAssignment, repo: Repository): Promise<ReviewOutcome> {
    const execution = this.catalog.find(assignment.runtime)

    if (execution === null) return this.failed(assignment, `Weaver cannot start ${assignment.runtime}`)
    if (!assignment.experiments) {
      return this.read(request, assignment, repo, await this.ask(execution, this.task(request, assignment, repo.top, null)))
    }

    const copy = this.copyOf(repo)

    if (typeof copy === 'string') return this.failed(assignment, copy)

    try {
      return this.read(request, assignment, repo, await this.ask(execution, this.task(request, assignment, copy.path, copy)))
    } finally {
      copy.discard()
    }
  }

  // A runtime that refuses a task, for a limit reached or a login that lapsed, may take it a minute later. A review
  // that ran out of time or answered out of shape would do the same again.
  private async ask(execution: AgentExecution, task: AgentTask): Promise<AgentResult> {
    const first = await execution.run(task)

    if (first.failureKind !== 'runtime' || !execution.isAvailable()) return first

    await sleep(this.retryAfterMs)

    return execution.run(task)
  }

  private copyOf(repo: Repository): ReviewCopy | string {
    let copy: ReviewCopy | null = null

    try {
      copy = ReviewCopy.reserve(repo, this.copies)
      copy.fill()

      return copy
    } catch (error) {
      copy?.discard()

      return `the project could not be copied for the reviewer: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  private task(request: ReviewRequest, assignment: ReviewAssignment, cwd: string, copy: ReviewCopy | null): AgentTask {
    const { runtime, model, effort, timeoutSeconds } = assignment

    return new AgentTask({
      prompt: request.prompt(copy?.path ?? null),
      cwd,
      access: copy === null ? 'read-only' : 'write',
      beforeTool: copy === null ? null : [process.execPath, this.hook, 'PreToolUse', `--agent=${runtime}`, ReviewCopy.flag(copy.path)],
      timeoutSeconds,
      model,
      effort,
      answerSchema: request.schema(),
      environment: { [AgentReviewer.MARK]: '1' },
    })
  }

  // The findings are placed on the working tree the unit left, whatever the reviewer did to its copy.
  private read(request: ReviewRequest, assignment: ReviewAssignment, repo: Repository, result: AgentResult): ReviewOutcome {
    const { runtime, reason } = assignment
    const { seconds, costUsd } = result
    const answer = result.failure === null ? new AnswerReader(request.rules, request.files, repo.top).read(result.answer) : null

    if (answer === null) {
      return new ReviewOutcome({
        runtime,
        reason,
        seconds,
        costUsd,
        failure: result.failure ?? 'the reviewer answered without a list of findings',
      })
    }

    return new ReviewOutcome({ runtime, reason, seconds, costUsd, ...answer })
  }

  private failed(assignment: ReviewAssignment, failure: string): ReviewOutcome {
    return new ReviewOutcome({ runtime: assignment.runtime, reason: assignment.reason, seconds: 0, failure })
  }
}
