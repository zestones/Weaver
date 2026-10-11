import { AgentResult, AgentTask, type ExecutionCatalog } from '@weaver/agent-sdk'
import type { Card } from '../../cards/card.ts'
import { CardRegistry } from '../../registry/card-registry.ts'
import { AnswerApplier } from '../answer/answer-applier.ts'
import { AnswerReader } from '../answer/answer-reader.ts'
import type { WriterJob } from '../request/writer-job.ts'
import { WriterRequest } from '../request/writer-request.ts'

// How many flags one task writes up: more, and the time the project gives a task no longer fits them.
const BATCH_SIZE = 5
const KNOWN_LIMIT = 40

// What the worker does: while flags wait and it holds the writer's turn, it asks one agent to write them up, a few
// at a time, and applies what comes back.
export class WriterRun {
  // A flag that could not be written is tried once more, by a later run.
  static readonly MAX_ATTEMPTS = 2

  private readonly job: WriterJob
  private readonly executions: ExecutionCatalog
  private readonly registry: CardRegistry | null

  constructor(job: WriterJob, executions: ExecutionCatalog, registry?: CardRegistry) {
    this.job = job
    this.executions = executions
    this.registry = registry ?? null
  }

  async run(): Promise<void> {
    const registry = this.registry ?? new CardRegistry(this.job.stateDir)

    try {
      if (registry.takeWriterTurn(process.pid)) await this.write(registry)
    } finally {
      if (this.registry === null) registry.close()
    }
  }

  // Flags made while the writer works are written up before it leaves.
  private async write(registry: CardRegistry): Promise<void> {
    const tried = new Set<number>()

    try {
      let flags = this.next(registry, tried)

      while (flags.length > 0) {
        for (const flag of flags) tried.add(flag.number)

        await this.writeUp(registry, flags)
        flags = this.next(registry, tried)
      }
    } finally {
      registry.leaveWriterTurn(process.pid)
    }
  }

  private next(registry: CardRegistry, tried: ReadonlySet<number>): Card[] {
    return registry
      .awaitingWriter(WriterRun.MAX_ATTEMPTS)
      .filter((flag) => !tried.has(flag.number))
      .slice(0, BATCH_SIZE)
  }

  private async writeUp(registry: CardRegistry, flags: readonly Card[]): Promise<void> {
    const { settings, labels } = this.job
    const numbers = flags.map((flag) => flag.number)
    const files = flags.flatMap((flag) => flag.places.map((place) => place.file))
    const known = registry
      .about(files)
      .filter((card) => !numbers.includes(card.number))
      .slice(0, KNOWN_LIMIT)
    const result = await this.ask(new WriterRequest(this.job, flags, known))
    const reader = new AnswerReader(labels, settings.sections)
    const applier = new AnswerApplier(registry, {
      runtime: settings.runtime,
      model: settings.model,
      seconds: result.seconds,
      costUsd: result.costUsd,
    })

    for (const flag of numbers) {
      // A flag may be the same thing as a card already known, or as a flag written up just before it.
      const same = [...known.map((card) => card.number), ...numbers.filter((earlier) => earlier < flag)]

      applier.apply(flag, result.failure ?? reader.read(result.answer, flag, same))
    }
  }

  // Whatever goes wrong, the flags are told: one left without an answer would be asked again at every run.
  private async ask(request: WriterRequest): Promise<AgentResult> {
    const { runtime, model, effort, timeoutSeconds } = this.job.settings
    const execution = this.executions.find(runtime)

    if (execution === null) return new AgentResult({ text: '', seconds: 0, failure: `Weaver cannot start ${runtime}` })

    try {
      return await execution.run(
        new AgentTask({
          prompt: request.prompt(),
          cwd: this.job.top,
          access: 'read-only',
          timeoutSeconds,
          model,
          effort,
          answerSchema: request.schema(),
          environment: this.job.environment,
        }),
      )
    } catch (error) {
      return new AgentResult({
        text: '',
        seconds: 0,
        failure: `the writer broke: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }
}
