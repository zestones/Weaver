#!/usr/bin/env node
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

    try {
      const answer =
        copy === null
          ? await new Loop().handle(eventName, this.argv, await this.input())
          : new ReviewerLoop(copy).handle(eventName, this.argv, await this.input())

      process.stdout.write(answer.print())
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)

      process.stdout.write(Answer.saying(`[weaver] The ${eventName} hook failed: ${reason}`).print())
    }
  }

  // Read as a stream: a synchronous read of a non-blocking stdin throws EAGAIN.
  private async input(): Promise<string> {
    const chunks: Buffer[] = []

    for await (const chunk of process.stdin) chunks.push(chunk as Buffer)

    return Buffer.concat(chunks).toString('utf8')
  }
}

await new HookProgram(process.argv.slice(2)).run()
