import { readFileSync } from 'node:fs'
import type { Output } from '../../output/output.ts'
import type { Command } from '../line/command.ts'

interface Manifest {
  readonly version: string
}

// A release stamps its version in the manifest it ships; a checkout keeps the development default.
export class VersionCommand implements Command {
  readonly name = 'version'
  readonly usage = 'version'
  readonly summary = 'Say which version of Weaver this is.'
  readonly ownerOnly = false
  private readonly output: Output

  constructor(output: Output) {
    this.output = output
  }

  run(): number {
    const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as Manifest

    this.output.say(`weaver ${manifest.version}`)

    return 0
  }
}
