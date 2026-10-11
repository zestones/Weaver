import { CardRegistry, WriterRun, type WriterLauncher } from '@weaver/memory'
import type { Declaration } from '../../declaration/content/declaration.ts'
import type { Repository } from '../../lib/git/repository.ts'

// Starts the writer of a project on the flags that wait for one.
export class WriterStart {
  private readonly launcher: WriterLauncher
  private readonly environment: Readonly<Record<string, string>>

  // `environment` is what the writer runs with: the caller names there what keeps its hooks silent.
  constructor(launcher: WriterLauncher, environment: Readonly<Record<string, string>>) {
    this.launcher = launcher
    this.environment = environment
  }

  // Nothing starts for a project that declares no writer: its flags stay raw, and nothing is spent.
  run(repo: Repository, declaration: Declaration): void {
    const { writer, labels } = declaration

    if (writer === null || !this.flagsWait(repo)) return

    const { runtime, model, effort, timeoutSeconds, skill, sections } = writer

    this.launcher.start({
      top: repo.top,
      stateDir: repo.stateDir,
      settings: { runtime, model, effort, timeoutSeconds, skill, sections },
      labels,
      environment: this.environment,
    })
  }

  private flagsWait(repo: Repository): boolean {
    const registry = new CardRegistry(repo.stateDir)

    try {
      return registry.awaitingWriter(WriterRun.MAX_ATTEMPTS).length > 0
    } finally {
      registry.close()
    }
  }
}
