import type { Declaration } from '../../declaration/content/declaration.ts'
import type { DeclaredCheck } from '../../declaration/content/declared-check.ts'
import type { CallDiff } from '../../unit-of-work/diff/call-diff.ts'
import type { UnitDiff } from '../../unit-of-work/diff/unit-diff.ts'
import type { Check } from '../kinds/check.ts'
import { ExitCheck } from '../kinds/exit-check.ts'
import { FindingsCheck } from '../kinds/findings-check.ts'
import type { CheckMemory } from '../results/check-memory.ts'
import type { CheckOutcome } from '../results/check-outcome.ts'
import type { CheckRunner } from './check-runner.ts'

const MIN_TIMEOUT_MS = 1000

export class ProjectChecks implements CheckRunner {
  warns(declaration: Declaration): boolean {
    return declaration.checks.some((declared) => declared.warn !== null)
  }

  async warn(declaration: Declaration, call: CallDiff, deadline: number): Promise<CheckOutcome[]> {
    const env = call.environment()
    const warning = declaration.checks.map((declared) => this.checkOf(declaration, declared)).filter((check) => check.warns)
    const waiting = [...warning]
    const done = new Map<string, CheckOutcome>()
    const next = async (): Promise<void> => {
      for (let check = waiting.shift(); check !== undefined; check = waiting.shift()) {
        const outcome = await this.warning(check, call, env, deadline - Date.now())

        if (outcome !== null) done.set(check.id, outcome)
      }
    }

    try {
      await Promise.all(Array.from({ length: declaration.checkLimits.parallel }, next))
    } finally {
      call.forget()
    }

    // In the order the project declares them, whichever ended first.
    return warning.flatMap((check) => done.get(check.id) ?? [])
  }

  repairs(declaration: Declaration): boolean {
    return declaration.checks.some((declared) => declared.repair !== null)
  }

  // One after the other: two repairs at once could rewrite the same file.
  async repair(declaration: Declaration, unit: UnitDiff, deadline: number): Promise<void> {
    const env = unit.environment()

    for (const declared of declaration.checks) {
      const left = deadline - Date.now()

      // A repair is only an attempt: out of time, it is not started, and the checks still give their verdict.
      if (left <= 0) return

      await this.checkOf(declaration, declared).repair(unit, env, left)
    }
  }

  async judge(declaration: Declaration, unit: UnitDiff, deadline: number, memory?: CheckMemory): Promise<CheckOutcome[]> {
    const { parallel } = declaration.checkLimits
    const env = unit.environment()
    const checks = declaration.checks.map((declared) => this.checkOf(declaration, declared))
    const queue = [...checks]
    const done = new Map<string, CheckOutcome>()
    const running = new Map<string, Promise<void>>()

    while (queue.length > 0 || running.size > 0) {
      while (running.size < parallel) {
        const check = this.takeReady(queue, done)

        if (check === null) break

        running.set(
          check.id,
          this.start(check, done, unit, env, Math.max(MIN_TIMEOUT_MS, deadline - Date.now()), memory).then((outcome) => {
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

  private warning(check: Check, call: CallDiff, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<CheckOutcome | null> {
    return check
      .warn(call, env, timeoutMs)
      .catch((error: unknown) => check.broken(`the warning crashed: ${error instanceof Error ? error.message : String(error)}`))
  }

  private checkOf(declaration: Declaration, declared: DeclaredCheck): Check {
    const rules = declaration.rulesOf(declared.id)

    return declared.reads === 'findings' ? new FindingsCheck(declared, rules) : new ExitCheck(declared, rules)
  }

  private takeReady(queue: Check[], done: ReadonlyMap<string, CheckOutcome>): Check | null {
    const index = queue.findIndex((check) => check.after === null || done.has(check.after))

    return index === -1 ? null : (queue.splice(index, 1)[0] ?? null)
  }

  private async start(
    check: Check,
    done: ReadonlyMap<string, CheckOutcome>,
    unit: UnitDiff,
    env: NodeJS.ProcessEnv,
    timeoutMs: number,
    memory: CheckMemory | undefined,
  ): Promise<CheckOutcome> {
    const prerequisite = check.after === null ? undefined : done.get(check.after)

    if (prerequisite?.status === 'timeout') return check.skipped(`${prerequisite.id} did not finish`)

    const kept = memory?.recall(check, unit) ?? null

    if (kept !== null) return kept

    const outcome = await check
      .judge(unit, env, timeoutMs)
      .catch((error: unknown) => check.broken(`the check crashed: ${error instanceof Error ? error.message : String(error)}`))

    memory?.keep(check, unit, outcome)

    return outcome
  }
}
