import { readFileSync } from 'node:fs'

// The manifest the engine ships with. A release stamps its version there; a checkout keeps the development default.
export class EngineManifest {
  readonly version: string

  constructor() {
    const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string }

    this.version = manifest.version
  }
}
