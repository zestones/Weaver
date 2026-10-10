import type { Declaration } from '../../declaration/content/declaration.ts'
import type { DeclaredCheck } from '../../declaration/content/declared-check.ts'
import type { UnitDiff } from '../../unit-of-work/diff/unit-diff.ts'
import type { Check } from '../kinds/check.ts'
import { ExitCheck } from '../kinds/exit-check.ts'
import { FindingsCheck } from '../kinds/findings-check.ts'
import type { CheckOutcome } from '../results/check-outcome.ts'
import type { CheckRunner } from './check-runner.ts'

const MIN_TIMEOUT_MS = 1000

export class ProjectChecks implements CheckRunner {
  async run(declaration: Declaration, unit: UnitDiff): Promise<CheckOutcome[]> {
    const { concurrency, deadlineSeconds } = declaration.finish
    const deadline = Date.now() + deadlineSeconds * 1000
    const env = unit.environment()
    const checks = declaration.checks.map((declared) => this.checkOf(declaration, declared))
    const queue = [...checks]
    const done = new Map<string, CheckOutcome>()
    const running = new Map<string, Promise<void>>()

    while (queue.length > 0 || running.size > 0) {
      while (running.size < concurrency) {
        const check = this.takeReady(queue, done)

        if (check === null) break

        running.set(
          check.id,
          this.start(check, done, unit, env, Math.max(MIN_TIMEOUT_MS, deadline - Date.now())).then((outcome) => {
            done.set(check.id, outcome)
            running.delete(check.id)
          }),
        )
      }

      // A cycle of `after` leaves checks that can never start: they are reported, not waited for.
      if (running.size === 0) break

      await Promise.race(running.values())
    }

    return checks.map((check) => done.get(check.id) ?? check.broken('the check never started: its `after` chain loops'))
  }

  private checkOf(declaration: Declaration, declared: DeclaredCheck): Check {
    const rules = declaration.rulesOf(declared.id)

    return declared.reads === 'findings' ? new FindingsCheck(declared, rules) : new ExitCheck(declared, rules)
  }

  private takeReady(queue: Check[], done: ReadonlyMap<string, CheckOutcome>): Check | null {
    const index = queue.findIndex((check) => check.after === null || done.has(check.after))

    return index === -1 ? null : (queue.splice(index, 1)[0] ?? null)
  }

  private start(
    check: Check,
    done: ReadonlyMap<string, CheckOutcome>,
    unit: UnitDiff,
    env: NodeJS.ProcessEnv,
    timeoutMs: number,
  ): Promise<CheckOutcome> {
    const prerequisite = check.after === null ? undefined : done.get(check.after)

    if (prerequisite?.status === 'timeout') return Promise.resolve(check.skipped(`${prerequisite.id} did not finish`))

    return check
      .run(unit, env, timeoutMs)
      .catch((error: unknown) => check.broken(`the check crashed: ${error instanceof Error ? error.message : String(error)}`))
  }
}
