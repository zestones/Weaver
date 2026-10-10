import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Declaration } from '../../declaration/content/declaration.ts'
import type { CheckOutcome } from './check-outcome.ts'
import type { UnitVerdict } from './unit-verdict.ts'

export class Report {
  private readonly declaration: Declaration
  private readonly verdict: UnitVerdict

  constructor(declaration: Declaration, verdict: UnitVerdict) {
    this.declaration = declaration
    this.verdict = verdict
  }

  write(dir: string): string {
    const { unit, round } = this.verdict
    const reports = join(dir, 'reports')

    mkdirSync(reports, { recursive: true })

    // A new request starts the rounds again: the sequence keeps an earlier report from being overwritten.
    const sequence = String(readdirSync(reports).length + 1).padStart(4, '0')
    const path = join(reports, `${sequence}-unit-${String(unit)}-round-${String(round)}.md`)

    writeFileSync(path, this.render())

    return path
  }

  refusal(reportPath: string): string {
    const { round, maxRounds, blocking } = this.verdict

    return [
      `[weaver] The checks fail on this unit of work (round ${String(round)} of ${String(maxRounds)}): fix what follows, then finish again.`,
      '',
      ...blocking.flatMap((outcome) => this.failureBlock(outcome)),
      `Report: ${reportPath}`,
    ].join('\n')
  }

  summary(reportPath: string): string {
    const { outcomes, diff, unattributed } = this.verdict
    const waiting = this.verdict.toValidate().length
    const ran = outcomes.filter((outcome) => outcome.ran).length
    const parts = [`[weaver] ${String(ran)} check(s) passed on ${String(diff.files.length)} changed file(s).`]

    if (diff.excluded.length > 0) {
      parts.push(`Not looked at: ${diff.excluded.map(({ folder, files }) => `${String(files)} file(s) under ${folder}/`).join(', ')}.`)
    }

    if (unattributed.length > 0) parts.push(`Changed during its commands, not charged: ${unattributed.join(', ')}.`)
    if (waiting > 0) parts.push(`${String(waiting)} item(s) to validate.`)

    return [...parts, `Report: ${reportPath}`].join(' ')
  }

  private render(): string {
    const { verdict, declaration } = this
    const { diff } = verdict

    return [
      `# Unit ${String(verdict.unit)}, round ${String(verdict.round)}: ${verdict.passed ? 'checks passed' : 'checks failed'}`,
      ...this.section(
        `Changed files (${String(diff.files.length)})`,
        diff.files.map((file) => `- ${file.status} ${file.path}`),
      ),
      ...this.section(
        'Changed during the session’s commands, not charged',
        verdict.unattributed.map((path) => `- ${path}`),
      ),
      ...this.section(
        'Checks',
        verdict.outcomes.flatMap((outcome) => this.checkLines(outcome)),
      ),
      ...this.section(
        'To validate',
        verdict.toValidate().map((line) => `- ${line}`),
      ),
      ...this.section(
        'For the reviewer (no review runs yet)',
        declaration
          .reviewCriteria(diff.paths)
          .map((rule) => `- ${rule.id}: ${rule.statement}${rule.source === null ? '' : ` (${rule.source})`}`),
      ),
      '',
    ].join('\n')
  }

  private section(title: string, lines: readonly string[]): string[] {
    return lines.length === 0 ? [] : ['', `## ${title}`, '', ...lines]
  }

  private checkLines(outcome: CheckOutcome): string[] {
    const head = `- ${outcome.status} \`${outcome.id}\` (${outcome.rules.join(', ')}), ${String(outcome.ms)} ms`
    const reason = outcome.reason === null ? [] : [`  ${outcome.reason}`]
    const output =
      outcome.status === 'pass' || outcome.status === 'skip' || outcome.output.trim() === ''
        ? []
        : ['', '```', outcome.output.trim(), '```', '']

    return [`${head}${outcome.failedWithoutBlocking ? ', not blocking' : ''}`, ...reason, ...output]
  }

  private failureBlock(outcome: CheckOutcome): string[] {
    const statements = outcome.rules.map((rule) => `${rule}: ${this.declaration.statementOf(rule)}`).join(' | ')
    const head = `${outcome.status === 'timeout' ? 'TIMEOUT' : 'FAIL'} ${outcome.id} (${statements})`

    return [head, ...(outcome.reason === null ? [] : [`  ${outcome.reason}`]), ...outcome.failureLines().map((line) => `  ${line}`), '']
  }
}
