import { OwnRelease } from '../../link/own-release.ts'
import type { Output } from '../../output/output.ts'
import type { Command } from '../line/command.ts'

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
    this.output.say(`weaver ${new OwnRelease().version}`)

    return 0
  }
}
