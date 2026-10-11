import type { Rule } from '../../declaration/rules/rule.ts'
import type { ProcessResult } from '../../lib/process/process.ts'
import type { Finding } from '../../declaration/rules/finding.ts'
import type { CheckOutcome } from '../results/check-outcome.ts'
import { Check } from './check.ts'

export class FindingsCheck extends Check {
  protected override read(result: ProcessResult): CheckOutcome {
    const findings = this.findings(result.stdout)

    if (findings === null) return this.broken('the check did not print its findings as JSON on its last line', result.output, result.ms)

    const stray = findings.find((finding) => this.ruleOf(finding) === undefined)

    if (stray !== undefined) {
      return this.broken(`a finding names ${stray.rule}, a rule this check does not stand behind`, result.output, result.ms)
    }

    const failures = findings.filter((finding) => this.ruleOf(finding)?.blocks === true)
    const crashed = failures.length === 0 && result.code !== 0
    const failed = failures.length > 0 || crashed

    return this.outcome({
      status: failed ? 'fail' : 'pass',
      blocking: failed,
      ms: result.ms,
      output: result.output,
      reason: crashed ? `the check exited with ${String(result.code)}` : null,
      failures,
      toValidate: findings.filter((finding) => this.ruleOf(finding)?.waitsForOwner === true),
      candidates: findings.filter((finding) => this.ruleOf(finding)?.level === 'llm'),
    })
  }

  private ruleOf(finding: Finding): Rule | undefined {
    return this.rules.find((rule) => rule.id === finding.rule)
  }

  private findings(stdout: string): Finding[] | null {
    const last = stdout.trim().split('\n').at(-1) ?? ''

    try {
      const parsed: unknown = JSON.parse(last)
      const findings = typeof parsed === 'object' && parsed !== null ? (parsed as { findings?: unknown }).findings : undefined

      return Array.isArray(findings) && findings.every((finding) => this.isFinding(finding)) ? findings : null
    } catch {
      return null
    }
  }

  private isFinding(value: unknown): value is Finding {
    if (typeof value !== 'object' || value === null) return false

    const item = value as Partial<Record<keyof Finding, unknown>>

    return (
      typeof item.rule === 'string' &&
      typeof item.file === 'string' &&
      typeof item.message === 'string' &&
      (item.line === undefined || typeof item.line === 'number')
    )
  }
}
