import { spawnSync } from 'node:child_process'
import { ReviewLedger, type Closing, type FollowedPoint } from '@weaver/engine'
import type { Output } from '../output/output.ts'
import { Project } from '../project/project.ts'
import type { Command } from './command.ts'

interface Filed {
  readonly said?: string
  readonly problem?: string
}

const TITLE_LENGTH = 80

export class CloseCommand implements Command {
  readonly name = 'close'
  readonly usage = `close <id> ${ReviewLedger.CLOSINGS.join('|')} [note]`
  readonly summary = 'Close a point that weaver status lists: it was fixed, it will not be, or it is now an issue of its own.'
  private readonly cwd: string
  private readonly output: Output

  constructor(cwd: string, output: Output) {
    this.cwd = cwd
    this.output = output
  }

  run(args: readonly string[]): number {
    const [id, as, ...words] = args
    const closing = ReviewLedger.CLOSINGS.find((known): known is Closing => known === as)

    if (id === undefined || closing === undefined) {
      this.output.say(`weaver ${this.usage}`)

      return 2
    }

    const project = Project.locate(this.cwd)
    const ledger = project.reviewLedger()
    const point = ledger.waiting().find((waiting) => waiting.id === id)
    const filed = closing === 'issue' && point !== undefined ? this.filed(project, point) : {}

    if (filed.problem !== undefined) {
      this.output.say(filed.problem)

      return 1
    }

    const note = [...words, ...(filed.said === undefined ? [] : [filed.said])].join(' ')
    const problem = ledger.close(id, closing, note === '' ? null : note)

    this.output.say(problem ?? `${id} closed as ${closing}${filed.said === undefined ? '' : `: ${filed.said}`}.`)

    return problem === null ? 0 : 1
  }

  // Where issues live is the project's business: it names the command that files one, or the point is only recorded.
  private filed(project: Project, point: FollowedPoint): Filed {
    const line = project.readableDeclaration()?.review?.issue ?? null

    if (line === null) return {}

    const described = ReviewLedger.describe(point)
    const values: Readonly<Record<string, string>> = {
      '{title}': described.length <= TITLE_LENGTH ? described : `${described.slice(0, TITLE_LENGTH - 1)}…`,
      '{body}': `${described}\n\nLeft by a review (${point.id}): ${point.standing}`,
    }
    const [command = '', ...args] = line.map((word) => values[word] ?? word)
    const result = spawnSync(command, args, { cwd: project.top, encoding: 'utf8' })

    return result.status === 0
      ? { said: result.stdout.trim() }
      : { problem: `the issue was not filed, and ${point.id} stays open: ${(result.stderr || result.error?.message || '').trim()}` }
  }
}
