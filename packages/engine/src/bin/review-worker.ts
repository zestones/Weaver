#!/usr/bin/env node
import { dirname, extname, join } from 'node:path'
import { ExecutionCatalog } from '@weaver/agent-sdk'
import { Repository } from '../lib/git/repository.ts'
import { AgentReviewer } from '../review/running/agent-reviewer.ts'
import { ReviewRun } from '../review/running/review-run.ts'

class ReviewWorkerProgram {
  private readonly script: string
  private readonly argv: readonly string[]

  constructor(script: string, argv: readonly string[]) {
    this.script = script
    this.argv = argv
  }

  // Started by the hook at the end of a turn, and left to run: it says nothing, and what it finds is in the store.
  async run(): Promise<void> {
    const [top = '', sessionDir = '', content = ''] = this.argv
    const repo = Repository.locate(top)

    if (repo === null) return

    // A reviewer that writes is held by the hook, the program beside this one.
    const hook = join(dirname(this.script), `hook${extname(this.script)}`)

    await new ReviewRun(new AgentReviewer(new ExecutionCatalog(), { hook })).run(repo, sessionDir, content)
  }
}

await new ReviewWorkerProgram(process.argv[1] ?? '', process.argv.slice(2)).run()
