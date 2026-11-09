import type { ExecutionCatalog } from '@weaver/agent-sdk'
import { CardRegistry, WriterRun } from '@weaver/memory'
import { Counted } from '../../output/counted.ts'
import type { Screen } from '../../output/screen.ts'
import { Project } from '../../project/project.ts'

export class WriteCards {
  private readonly executions: ExecutionCatalog
  private readonly cwd: string
  private readonly screen: Screen

  constructor(cwd: string, screen: Screen, executions: ExecutionCatalog) {
    this.executions = executions
    this.cwd = cwd
    this.screen = screen
  }

  async run(args: readonly string[]): Promise<number> {
    const words = args.filter((word) => word !== '--retry-failed')
    const batches = words.length === 0 ? 4 : words[0] === '--batches' && words.length === 2 ? Number(words[1]) : NaN
    if (!Number.isInteger(batches) || batches < 1 || batches > 100) {
      this.screen.misuse('cards write', 'cards write [--batches <1..100>] [--retry-failed]')
      return 2
    }
    const project = Project.locate(this.cwd)
    const declaration = project.declaration()
    const writer = declaration?.writer
    if (writer === null || writer === undefined) {
      this.screen.error('No writer is declared or writing is disabled.')
      return 1
    }
    const registry = new CardRegistry(project.repository.stateDir, {
      author: writer.runtime,
      role: 'author',
      session: null,
      subagent: null,
      unit: null,
      requests: [],
      commit: project.repository.head(),
      at: new Date().toISOString(),
    })
    try {
      if (args.includes('--retry-failed')) registry.retryWriting()
      await new WriterRun(
        {
          top: project.top,
          stateDir: project.repository.stateDir,
          settings: { ...writer, batches },
          labels: declaration?.labels ?? {},
          environment: { WEAVER_REVIEWER: '1' },
        },
        this.executions,
        registry,
      ).run()
      const waiting = registry.awaitingWriter(Number.MAX_SAFE_INTEGER)
      this.screen.note(`Writing finished; ${new Counted(waiting.length, 'flag remains', 'flags remain').text} raw.`)
      return waiting.some((card) => card.record.writing.failure !== null) ? 1 : 0
    } finally {
      registry.close()
    }
  }
}
