#!/usr/bin/env node
import { ExecutionCatalog } from '@weaver/agent-sdk'
import { CardRegistry } from '../registry/card-registry.ts'
import type { WriterJob } from '../writing/request/writer-job.ts'
import { WriterRun } from '../writing/running/writer-run.ts'

class CardWriterWorkerProgram {
  private readonly argv: readonly string[]

  constructor(argv: readonly string[]) {
    this.argv = argv
  }

  // Started at the end of a turn, and left to run: it says nothing, and what it wrote is in the registry. A flag it
  // could not write up stays raw there.
  async run(): Promise<void> {
    try {
      const job = JSON.parse(this.argv[0] ?? '') as WriterJob
      const registry = new CardRegistry(job.stateDir)

      try {
        await new WriterRun(job, new ExecutionCatalog(), registry).run()
      } finally {
        registry.close()
      }
    } catch {
      process.exitCode = 1
    }
  }
}

await new CardWriterWorkerProgram(process.argv.slice(2)).run()
