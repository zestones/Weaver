import type { Declaration } from '../../declaration/content/declaration.ts'
import { ChecksOnDemand } from './checks-on-demand.ts'

// What an agent is told of `weaver check` with every request, in a project that declares checks: without it, the only
// way it knows to hear a check is to say that it has finished.
export class CheckBriefing {
  // null in a project with no check.
  readonly text: string | null

  constructor(declaration: Declaration) {
    const names = declaration.checks.map((check) => check.id)
    const command = `weaver ${ChecksOnDemand.COMMAND}`

    this.text =
      names.length === 0
        ? null
        : [
            `When your task ends, Weaver runs the checks of this project on what you changed, and a failure sends you back to work. To hear them before, run \`${command} <name>...\` with your shell tool, or \`${command}\` alone for all of them: they judge your work in progress as the end of the task will, without ending it and without counting as a refusal. The checks of this project: ${names.join(', ')}.`,
            'A check may take minutes: run the command in the background if your shell tool can, so that its time limit does not cut it, and go on meanwhile. If nothing changes after it, the end of your task gives its verdict again at once, without running it.',
          ].join(' ')
  }
}
