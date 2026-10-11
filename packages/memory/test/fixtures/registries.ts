import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CardRegistry } from '../../src/registry/card-registry.ts'

export interface Registries {
  // A state folder of its own, not created yet.
  folder(): string
  // A registry of its own, closed with the others.
  fresh(): CardRegistry
  discard(): void
}

export function registriesIn(name: string): Registries {
  const scratch = mkdtempSync(join(tmpdir(), `weaver-memory-${name}-`))
  const opened: CardRegistry[] = []
  let folders = 0

  return {
    folder: () => join(scratch, String(++folders)),
    fresh() {
      const registry = new CardRegistry(this.folder())

      opened.push(registry)

      return registry
    },
    discard() {
      for (const registry of opened) {
        try {
          registry.close()
        } catch {
          // The test closed it already.
        }
      }

      rmSync(scratch, { recursive: true, force: true })
    },
  }
}
