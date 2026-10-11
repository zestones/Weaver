import { ReviewLedger } from '@weaver/engine'
import type { Output } from '../output/output.ts'
import { Project } from '../project/project.ts'
import type { Command } from './command.ts'

export class StatusCommand implements Command {
  readonly name = 'status'
  readonly usage = 'status'
  readonly summary = 'List what the reviews left for you: the findings an agent did not fix, and what a reviewer suspects.'
  private readonly cwd: string
  private readonly output: Output

  constructor(cwd: string, output: Output) {
    this.cwd = cwd
    this.output = output
  }

  run(): number {
    const points = Project.locate(this.cwd).reviewLedger().waiting()

    if (points.length === 0) {
      this.output.say('Nothing waits for you.')

      return 0
    }

    this.output.say(`${String(points.length)} point(s) wait for you:`)

    for (const point of points) {
      this.output.say(`  ${point.id}  ${ReviewLedger.describe(point)}`)
      this.output.say(`      ${point.standing}`)
    }

    this.output.say(`Close one with: weaver close <id> ${ReviewLedger.CLOSINGS.join('|')} [note]`)

    return 0
  }
}
