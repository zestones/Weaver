import { counted } from '../lib/text/counted.ts'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Declaration } from '../declaration/content/declaration.ts'
import { DeclarationFolder } from '../declaration/reading/declaration-folder.ts'
import { DeclarationParts } from '../declaration/reading/declaration-parts.ts'
import type { CheckOutcome } from '../checks/results/check-outcome.ts'
import type { UnitReview } from '../review/rounds/unit-review.ts'
import type { UnitVerdict } from './unit-verdict.ts'

const ANSWER_HOW =
  'Answer each finding in your final message, one line each: `F1 fixed: <what you changed>` or `F1 not fixed: <why>`. A finding answered `fixed` needs a change in its file. Then finish again.'
// The name of a rule is a handle for the project: the owner reads what the rule asks.
const IN_WORDS = 'When you speak of a rule to the owner, say what it asks: its name alone tells them nothing.'
const HEADS: Readonly<Record<string, string>> = {
  'sent-back': 'sent back to the agent, which answers each finding:',
  'answers-wanted': 'the agent was asked again for its answers:',
  answered: 'answered by the agent:',
  'for-owner': 'found once the review may refuse no more, left to the owner:',
}

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
    const { round, maxRefusals, blocking } = this.verdict

    const kept = blocking.filter((outcome) => outcome.keptFrom !== null).map((outcome) => outcome.id)
    const unchanged =
      kept.length === 0
        ? []
        : [
            `Not run again, since nothing they read changed after their last run: ${kept.join(', ')}. Finishing again without a change gets the same verdict: fix the files, or tell the owner what keeps you from it.`,
          ]

    return [
      `[weaver] The checks fail on this unit of work (refusal ${String(round)} of ${String(maxRefusals)}): fix what follows, then finish again.`,
      IN_WORDS,
      ...unchanged,
      '',
      ...blocking.flatMap((outcome) => this.failureBlock(outcome)),
      ...this.repairedLines(),
      `Report: ${reportPath}`,
    ].join('\n')
  }

  reviewRefusal(review: UnitReview, reportPath: string): string {
    const { outcome, round, maxRefusals } = review

    if (review.standing === 'answers-wanted') {
      return [
        `[weaver] The review by ${outcome.runtime} waits for your answers:`,
        '',
        ...review.problems.map((problem) => `- ${problem}`),
        '',
        ANSWER_HOW,
        `Report: ${reportPath}`,
      ].join('\n')
    }

    return [
      `[weaver] The checks pass, and the reviewer (${outcome.runtime}) found ${counted(outcome.findings.length, 'point')} on this unit of work (refusal ${String(round)} of ${String(maxRefusals)}).`,
      'Fix each one, or decide to leave it: a finding never holds your change by itself, but each one needs your answer.',
      ANSWER_HOW,
      IN_WORDS,
      '',
      ...outcome.findings.flatMap((_, index) => this.findingLines(review, index, '', '  ')),
      '',
      ...this.repairedLines(),
      `Report: ${reportPath}`,
    ].join('\n')
  }

  summary(reportPath: string): string {
    const { outcomes, diff, unattributed } = this.verdict
    const waiting = this.verdict.toValidate().count
    const ran = outcomes.filter((outcome) => outcome.ran).length
    const parts =
      diff.files.length === 0
        ? ['[weaver] No file changed in this turn.']
        : [`[weaver] ${counted(ran, 'check')} passed on ${counted(diff.files.length, 'changed file')}.`]

    if (diff.excluded.length > 0) {
      parts.push(`Not looked at: ${diff.excluded.map(({ folder, files }) => `${counted(files, 'file')} under ${folder}/`).join(', ')}.`)
    }

    parts.push(...this.repairedLines(), ...this.reviewedLines())

    if (unattributed.length > 0)
      parts.push(
        `Changed during its commands, not charged: ${unattributed.join(', ')}, which another session works on or the command did not name.`,
      )
    if (waiting > 0) parts.push(`${counted(waiting, 'item')} to validate.`)

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
        'Changed during the session’s commands, not charged: another session works on them, or the command named other files',
        verdict.unattributed.map((path) => `- ${path}`),
      ),
      ...this.section(
        'Rewritten by a repair before the checks',
        verdict.repaired.map((path) => `- ${path}`),
      ),
      ...this.section(
        'Checks',
        verdict.outcomes.flatMap((outcome) => this.checkLines(outcome)),
      ),
      ...this.section('Review', this.reviewSection()),
      ...this.section('To validate', verdict.toValidate().lines()),
      ...this.section(
        'Rules for a reviewer, which no review judged',
        (verdict.review?.judged === true ? [] : declaration.reviewCriteria(diff.paths)).map((rule) => `- ${rule.id}: ${rule.statement}`),
      ),
      '',
    ].join('\n')
  }

  // The agent wrote these files otherwise: what it remembers of them is no longer what they hold.
  private repairedLines(): string[] {
    const { repaired } = this.verdict

    return repaired.length === 0
      ? []
      : [`Rewritten by a repair before the checks, read them again before you edit them: ${repaired.join(', ')}.`]
  }

  private reviewedLines(): string[] {
    const { review } = this.verdict

    if (review === null) return []

    const { outcome, standing } = review
    const found = counted(outcome.findings.length, 'finding')
    const suspected = outcome.suspicions.length === 0 ? '' : ` ${counted(outcome.suspicions.length, 'suspicion')} for you.`

    if (standing === 'skipped') return [`No review: ${outcome.reason}.`]
    if (standing === 'running') {
      return [
        `The review by ${outcome.runtime} is still running: the unit of work stays open, and its findings come with the next end of turn.`,
      ]
    }
    if (standing === 'failed') {
      return [`The review by ${outcome.runtime} did not give its findings: write #review in a request to have it tried again.`]
    }
    if (standing === 'interrupted') {
      return [
        `The review by ${outcome.runtime} was stopped with the end of turn that waited for it: write #review in a request to have it run again.`,
      ]
    }
    if (standing === 'clean') return [`Reviewed by ${outcome.runtime}: no finding.${suspected}`]
    if (standing === 'for-owner') return [`Reviewed by ${outcome.runtime}: ${found} left to you.${suspected}`]

    const fixed = review.answers.filter((answer) => answer.status === 'fixed').length

    return [`Reviewed by ${outcome.runtime}: ${found}, ${String(fixed)} answered fixed.${suspected}`]
  }

  private reviewSection(): string[] {
    const { review } = this.verdict

    if (review === null) return []

    const { outcome, standing } = review

    if (standing === 'skipped') return [`- no review: ${outcome.reason}`]

    const cost = outcome.costUsd === null ? '' : `, $${outcome.costUsd.toFixed(4)}`
    const head = `- by ${outcome.runtime} (${outcome.reason}) in ${String(Math.round(outcome.seconds))} s${cost}, review round ${String(review.round)}, ${counted(review.maxRefusals, 'refusal')} allowed`

    if (standing === 'running') {
      return [
        `- by ${outcome.runtime} (${outcome.reason}), still running after ${String(Math.round(outcome.seconds))} s: its findings come with the next end of turn`,
      ]
    }
    if (standing === 'failed') return [head, `- no findings could be read: ${outcome.failure ?? ''}`]
    if (standing === 'interrupted') return [head, `- stopped: ${outcome.failure ?? ''}`]

    return [
      head,
      ...(outcome.summary === '' ? [] : [`- ${outcome.summary}`]),
      ...(outcome.found ? [`- ${HEADS[standing] ?? ''}`] : ['- no finding']),
      ...outcome.findings.flatMap((_, index) => this.findingLines(review, index, '  - ', '    - ')),
      ...review.problems.map((problem) => `  - still wanted: ${problem}`),
      ...this.listed(
        'suspicions, for the owner:',
        outcome.suspicions.map(({ file, note }) => `${file ?? 'the change'}: ${note}`),
      ),
      ...this.listed(
        'what the reviewer ran:',
        outcome.experiments.map(({ command, observed }) => `\`${this.firstLine(command)}\`: ${observed}`),
      ),
      ...this.listed('reported by the reviewer and not shown to the agent:', [
        ...outcome.dropped,
        ...(outcome.truncated === 0 ? [] : [`${counted(outcome.truncated, 'more finding')}, past the limit`]),
      ]),
    ]
  }

  // One finding as its author and the owner read it: what is wrong, where, and what goes with it.
  private findingLines(review: UnitReview, index: number, bullet: string, under: string): string[] {
    const finding = review.outcome.findings[index]
    const answer = review.answerOf(index)

    if (finding === undefined) return []

    const rule = this.declaration.statementOf(finding.rule)

    return [
      `${bullet}${review.outcome.line(index)}`,
      ...(rule === '' ? [] : [`${under}Rule: ${rule}`]),
      ...(finding.quote === null ? [] : [`${under}Quote: \`${finding.quote}\``]),
      ...(finding.suggestion === null ? [] : [`${under}Suggestion: ${finding.suggestion}`]),
      ...(finding.evidence === null ? [] : [`${under}Evidence: ${finding.evidence}`]),
      ...(answer === null ? [] : [`${under}Answered ${answer.status.replace('-', ' ')}: ${answer.why}`]),
    ]
  }

  // A script given as a command would break the list it is shown in: the review kept in the session holds all of it.
  private firstLine(command: string): string {
    const [first = '', ...others] = command.trim().split('\n')

    return others.length === 0 ? first : `${first} [${counted(others.length, 'more line')}]`
  }

  private listed(title: string, lines: readonly string[]): string[] {
    return lines.length === 0 ? [] : [`- ${title}`, ...lines.map((line) => `  - ${line}`)]
  }

  private section(title: string, lines: readonly string[]): string[] {
    return lines.length === 0 ? [] : ['', `## ${title}`, '', ...lines]
  }

  private checkLines(outcome: CheckOutcome): string[] {
    const given = outcome.keptFrom === null ? '' : `, given again from its run at ${outcome.keptFrom}: nothing it reads changed since`
    const head = `- ${outcome.status} \`${outcome.id}\` (${outcome.rules.join(', ')}), ${String(outcome.ms)} ms${given}`
    const reason = outcome.reason === null ? [] : [`  ${outcome.reason}`]
    const output =
      outcome.status === 'pass' || outcome.status === 'skip' || outcome.output.trim() === ''
        ? []
        : ['', '```', outcome.output.trim(), '```', '']

    return [`${head}${outcome.failedWithoutBlocking ? ', not blocking' : ''}`, ...reason, ...output]
  }

  private failureBlock(outcome: CheckOutcome): string[] {
    const behind = this.behind(outcome)
    const head = `${outcome.status === 'timeout' ? 'TIMEOUT' : 'FAIL'} ${outcome.id}${behind === null ? '' : ` (${behind})`}`

    return [head, ...(outcome.reason === null ? [] : [`  ${outcome.reason}`]), ...outcome.failureLines().map((line) => `  ${line}`), '']
  }

  // The sentences of the rules the failure is about. When the check does not say which of its rules broke, quoting
  // them all would bury what it printed: the agent is told how many there are and where they are written.
  private behind(outcome: CheckOutcome): string | null {
    const { concerned, rules } = outcome

    if (concerned.length > 0) return concerned.map((rule) => `${rule}: ${this.declaration.statementOf(rule)}`).join(' | ')
    if (rules.length === 0) return null

    return `one of its ${String(rules.length)} rules, written in ${DeclarationFolder.NAME}/${DeclarationParts.FILES.checks}: what it printed says which`
  }
}
