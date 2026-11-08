#!/usr/bin/env node
import { Payload } from '../agents/events/payload.ts'
import { Repository } from '../lib/git/repository.ts'
import { Journal } from '../unit-of-work/journal/journal.ts'
import { HookFeedback } from '../loop/exchange/hook-feedback.ts'
import { Loop } from '../loop/dispatch/loop.ts'
import { ReviewerLoop } from '../loop/dispatch/reviewer-loop.ts'
import { Answer } from '../loop/exchange/answer.ts'
import { AgentReviewer } from '../review/running/agent-reviewer.ts'
import { ReviewCopy } from '../review/workspace/review-copy.ts'

class HookProgram {
  private readonly argv: readonly string[]

  constructor(argv: readonly string[]) {
    this.argv = argv
  }

  // A hook that fails lets its call through in both agent runtimes, so the program catches its own errors and says so.
  async run(): Promise<void> {
    const [eventName = ''] = this.argv.filter((arg) => !arg.startsWith('--'))

    const copy = ReviewCopy.fromArguments(this.argv)

    // A reviewer in its copy is held there; any other hook of a reviewer, and every hook of the writer of the cards,
    // answers nothing and keeps nothing.
    if (copy === null && process.env[AgentReviewer.MARK] !== undefined) return

    let input = ''

    try {
      input = await this.input()

      const answer =
        copy === null
          ? await new Loop().handle(eventName, this.argv, input)
          : new ReviewerLoop(
              copy,
              this.argv.find((arg) => arg.startsWith('--review-project='))?.slice('--review-project='.length) ?? copy,
            ).handle(eventName, this.argv, input)

      process.stdout.write(answer.print())
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)

      process.stdout.write(
        (copy === null ? this.failed(eventName, input, reason) : Answer.saying(`[weaver] The ${eventName} hook failed: ${reason}`)).print(),
      )
    }
  }

  private failed(event: string, input: string, reason: string): Answer {
    let payload = new Payload({})

    try {
      payload = Payload.parse(input)
    } catch {
      // Malformed input may still be diagnosed from the hook's working directory.
    }

    const repo = Repository.locate(payload.text('cwd') ?? process.cwd())

    if (repo !== null) {
      return new HookFeedback(new Journal(repo), { session: payload.text('session_id'), agent: null }).failure(event, reason)
    }

    return Answer.silent().context(
      event,
      `[weaver] The ${event} hook failed: ${reason.replace(/\s+/g, ' ').slice(0, 300)}. Tell the owner and run weaver doctor. Journal: .git/weaver/events (repository unavailable).`,
    )
  }

  // Read as a stream: a synchronous read of a non-blocking stdin throws EAGAIN.
  private async input(): Promise<string> {
    const chunks: Buffer[] = []

    for await (const chunk of process.stdin) chunks.push(chunk as Buffer)

    return Buffer.concat(chunks).toString('utf8')
  }
}

await new HookProgram(process.argv.slice(2)).run()
