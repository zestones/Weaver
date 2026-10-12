import { join, relative } from 'node:path'
import type { DeclaredCheck } from '../../declaration/content/declared-check.ts'
import type { Rule } from '../../declaration/rules/rule.ts'
import type { Repository } from '../../lib/git/repository.ts'
import type { ChangedPath } from '../../lib/git/tree-diff.ts'
import { runProcess, TIMED_OUT, type ProcessResult } from '../../lib/process/process.ts'
import { matchesAny } from '../../lib/text/glob.ts'
import type { CallDiff } from '../../unit-of-work/diff/call-diff.ts'
import type { UnitDiff } from '../../unit-of-work/diff/unit-diff.ts'
import { CheckOutcome, type OutcomeFields } from '../results/check-outcome.ts'

const FILES = '{files}'

export abstract class Check {
  protected readonly declared: DeclaredCheck
  protected readonly rules: readonly Rule[]

  constructor(declared: DeclaredCheck, rules: readonly Rule[]) {
    this.declared = declared
    this.rules = rules
  }

  get id(): string {
    return this.declared.id
  }

  get after(): string | null {
    return this.declared.after
  }

  get warns(): boolean {
    return this.declared.warn !== null
  }

  // What the check finds on the files a call just changed, read as a verdict would be. null when it has nothing to
  // say of them: no warning of its own, none of its files, or a run that did not end in time.
  async warn(call: CallDiff, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<CheckOutcome | null> {
    const files = this.concerned(call.files)

    if (this.declared.warn === null || files.length === 0) return null

    const result = await this.launch(this.declared.warn, files, call.repo, env, timeoutMs)

    return result === null || result.code === TIMED_OUT ? null : this.read(result)
  }

  // The repair is an attempt and `judge` gives the verdict: what the repair prints or how it exits decides nothing.
  async repair(unit: UnitDiff, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<void> {
    if (this.declared.repair !== null) {
      await this.launch(this.declared.repair, this.concerned(unit.files), unit.repo, env, this.within(timeoutMs))
    }
  }

  async judge(unit: UnitDiff, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<CheckOutcome> {
    const files = this.concerned(unit.files)

    if (files.length === 0) return this.skipped('the unit changed none of the files it is about')

    const result = await this.launch(this.declared.judge, files, unit.repo, env, this.within(timeoutMs))

    if (result === null) return this.skipped('the files it is about were all deleted')
    if (result.code === TIMED_OUT) return this.outcome({ status: 'timeout', blocking: true, ms: result.ms, output: result.output })

    return this.read(result)
  }

  skipped(reason: string): CheckOutcome {
    return this.outcome({ status: 'skip', blocking: false, ms: 0, output: '', reason })
  }

  // A check that cannot give its verdict fails: a broken check never lets work through.
  broken(reason: string, output = '', ms = 0): CheckOutcome {
    return this.outcome({ status: 'fail', blocking: true, ms, output, reason })
  }

  protected abstract read(result: ProcessResult): CheckOutcome

  protected outcome(fields: Omit<OutcomeFields, 'id' | 'rules'>): CheckOutcome {
    return new CheckOutcome({ ...fields, id: this.id, rules: this.rules.map((rule) => rule.id) })
  }

  // null when the command is about files and none of them is left.
  private launch(
    line: readonly string[],
    files: readonly ChangedPath[],
    repo: Repository,
    env: NodeJS.ProcessEnv,
    timeoutMs: number,
  ): Promise<ProcessResult> | null {
    const present = files.filter((file) => file.status !== 'D').map((file) => file.path)

    if (files.length === 0 || (line.includes(FILES) && present.length === 0)) return null

    const [command = '', ...args] = line
    const cwd = join(repo.top, this.declared.cwd)

    return runProcess(
      command,
      args.flatMap((arg) => (arg === FILES ? present.map((path) => relative(cwd, join(repo.top, path))) : [arg])),
      { cwd, env, timeoutMs },
    )
  }

  // The time one run of `judge` or of `repair` has, within what is left for all the checks.
  private within(timeoutMs: number): number {
    return Math.min(timeoutMs, this.declared.timeoutSeconds * 1000)
  }

  private concerned<File extends ChangedPath>(files: readonly File[]): File[] {
    const { when } = this.declared

    return when === null ? [...files] : files.filter((file) => matchesAny(when, file.path) || matchesAny(when, file.oldPath))
  }
}
