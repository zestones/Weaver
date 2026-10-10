import { join, relative } from 'node:path'
import type { DeclaredCheck } from '../../declaration/content/declared-check.ts'
import type { Rule } from '../../declaration/rules/rule.ts'
import type { ChangedFile } from '../../lib/git/tree-diff.ts'
import { runProcess, TIMED_OUT, type ProcessResult } from '../../lib/process/process.ts'
import { matchesAny } from '../../lib/text/glob.ts'
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

  async run(unit: UnitDiff, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<CheckOutcome> {
    const files = this.concerned(unit.files)

    if (files.length === 0) return this.skipped('the unit changed none of the files it is about')

    const present = files.filter((file) => file.status !== 'D').map((file) => file.path)

    if (this.declared.run.includes(FILES) && present.length === 0) return this.skipped('the files it is about were all deleted')

    const [command = '', ...args] = this.declared.run
    const cwd = join(unit.repo.top, this.declared.cwd)
    const result = await runProcess(
      command,
      args.flatMap((arg) => (arg === FILES ? present.map((path) => relative(cwd, join(unit.repo.top, path))) : [arg])),
      { cwd, env, timeoutMs: Math.min(timeoutMs, this.declared.timeoutSeconds * 1000) },
    )

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

  private concerned(files: readonly ChangedFile[]): ChangedFile[] {
    const { when } = this.declared

    return when === null ? [...files] : files.filter((file) => matchesAny(when, file.path) || matchesAny(when, file.oldPath))
  }
}
