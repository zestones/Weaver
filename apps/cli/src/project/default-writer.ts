import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DeclarationParts } from '@weaver/engine'
import type { EngineLink } from '../link/engine-link.ts'

export class DefaultWriter {
  private readonly top: string

  constructor(top: string) {
    this.top = top
  }

  create(link: EngineLink): boolean {
    const path = join(this.top, '.weaver', DeclarationParts.FILES.writer)
    if (existsSync(path)) return false
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(
      path,
      `${JSON.stringify({ $schema: link.schemaOf('writer'), runtime: 'codex', timeoutSeconds: 300, batches: 4 }, null, 2)}\n`,
    )
    return true
  }
}
