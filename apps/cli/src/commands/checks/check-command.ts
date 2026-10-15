import { ChecksOnDemand, type AskedVerdict, type CheckOutcome } from '@weaver/engine'
import type { Caller } from '../../caller/caller.ts'
import { Counted } from '../../output/counted.ts'
import type { Output } from '../../output/output.ts'
import { Screen } from '../../output/screen.ts'
import { Project } from '../../project/project.ts'
import type { Command } from '../line/command.ts'

// Runs the checks of the project on the work in progress, as the end of a task would: an agent hears the verdict of
// one check without ending its task, and the owner judges what they changed by hand.
export class CheckCommand implements Command {
  readonly name = ChecksOnDemand.COMMAND
  readonly usage = 'check [<name>...]'
  readonly summary = 'Run the checks of the project on the work in progress'
  readonly ownerOnly = false
  readonly help = {
    group: 'Supervision',
    description:
      'Run the checks of the project on the work in progress, as the end of a task runs them, without ending it or counting as a refusal. Under an agent, the work is the unit of work of its session; from your terminal, every file that differs from HEAD. Repairs wait for the end of the task. What a check says is kept: a task that ends with nothing changed since gets its verdict again at once.',
    words: [
      ['<name>...', 'The checks to run, as the project names them; a check runs after the one it waits for. All of them without a name'],
    ],
    examples: ['weaver check', 'weaver check backend'],
  } as const
  private readonly cwd: string
  private readonly screen: Screen
  private readonly caller: Caller

  constructor(cwd: string, output: Output, caller: Caller) {
    this.cwd = cwd
    this.screen = new Screen(output)
    this.caller = caller
  }

  async run(args: readonly string[]): Promise<number> {
    const project = Project.locate(this.cwd)
    const declaration = project.declaration()

    if (declaration === null) {
      this.screen.error('Nothing to check: this project declares nothing for Weaver.', 'weaver install sets it up.')

      return 1
    }

    const names = ChecksOnDemand.namesIn(args)
    const agent = this.caller.agent()
    const checks = new ChecksOnDemand(project.repository)
    const session = agent === null ? null : checks.sessionAsking(names, agent)

    if (agent !== null && session === null) {
      this.screen.error(
        `Nothing was checked: Weaver's hook did not see this command go by, so it cannot tell whose work to check.`,
        `Run weaver check as a command of its own in a project wired for ${agent}: weaver doctor says what is missing.`,
      )

      return 1
    }

    const verdict = await checks.run(declaration, names, session)

    this.shown(verdict)

    return verdict.outcomes.some((outcome) => outcome.blocking) ? 1 : 0
  }

  private shown(verdict: AskedVerdict): void {
    const whose = verdict.unit === null ? 'of your changes against HEAD' : `of the unit of work ${String(verdict.unit)} of this session`

    if (verdict.files.length === 0) {
      this.screen.line(`Nothing to check: no file changed ${whose.replace(/^of /, 'in ')}.`)

      return
    }

    this.screen.heading(`${new Counted(verdict.files.length, 'changed file').text} ${whose}`)

    for (const outcome of verdict.outcomes) this.outcome(outcome)

    if (verdict.unattributed.length > 0) {
      this.screen.note(
        `Changed during the session's commands, not charged and not checked: ${verdict.unattributed.join(', ')}. Another session works on them, or the command named other files.`,
      )
    }

    if (verdict.outcomes.some((outcome) => outcome.blocking)) {
      this.screen.hint('The end of the task repairs before it checks: what a repair fixes may still fail here.')
    }
  }

  private outcome(outcome: CheckOutcome): void {
    const given = outcome.keptFrom === null ? '' : `, given again from its run at ${outcome.keptFrom}: nothing it reads changed since`

    if (outcome.status === 'pass') {
      this.screen.done(`${outcome.id} passed${given}`)

      return
    }

    if (outcome.status === 'skip') {
      this.screen.note(`${outcome.id} did not run: ${outcome.reason ?? ''}`)

      return
    }

    const how = outcome.status === 'timeout' ? 'ran out of time' : 'failed'
    const line = `${outcome.id} ${how}${outcome.blocking ? '' : ', which holds nothing'}${given}`

    if (outcome.blocking) this.screen.problem(line)
    else this.screen.alert(line)

    for (const text of [...(outcome.reason === null ? [] : [outcome.reason]), ...outcome.failureLines()]) this.screen.line(`    ${text}`)
  }
}
