import { OwnRelease } from '../../link/own-release.ts'
import type { Output } from '../../output/output.ts'
import type { Command } from '../line/command.ts'

export class VersionCommand implements Command {
  readonly name = 'version'
  readonly usage = 'version'
  readonly summary = 'Show the version of Weaver'
  readonly ownerOnly = false
  readonly help = { group: 'Set up', description: 'Say which version of Weaver this is.', words: [], examples: ['weaver version'] } as const
  private readonly output: Output

  constructor(output: Output) {
    this.output = output
  }

  run(): number {
    this.output.say(`weaver ${new OwnRelease().version}`)

    return 0
  }
}
