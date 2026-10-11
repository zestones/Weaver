import type { AnswerSchema } from '@weaver/agent-sdk'
import type { ChangedFile } from '../../lib/git/tree-diff.ts'
import { FINDINGS_LIMIT } from '../findings/review-finding.ts'

// A rule as a reviewer is given it.
export interface ReviewCriterion {
  readonly id: string
  readonly statement: string
  readonly evidence: boolean
}

// Plain values only: a request is kept with its review, for the process that runs it and for a later try.
export interface ReviewRequestFields {
  readonly rules: readonly ReviewCriterion[]
  readonly files: readonly ChangedFile[]
  readonly patch: string
  readonly skill: string | null
  readonly requests: readonly string[]
  // What an earlier review of this work found, with what the author answered, one finding a line.
  readonly earlier: readonly string[]
  // The places a program of the project listed under a rule, one a line.
  readonly candidates: readonly string[]
  // What the cards of the repository say of these files, one card a line.
  readonly history: readonly string[]
}

const PATCH_LIMIT = 200_000
const TEXT = { type: 'string' }
const TEXT_OR_NONE = { type: ['string', 'null'] }

export class ReviewRequest {
  readonly fields: ReviewRequestFields

  constructor(fields: ReviewRequestFields) {
    this.fields = fields
  }

  get rules(): readonly ReviewCriterion[] {
    return this.fields.rules
  }

  get files(): readonly ChangedFile[] {
    return this.fields.files
  }

  // What the reviewer is told. The rules and the way to review are the project's; what it is shown and the answer it
  // must give are Weaver's. With a copy, it may run and write there; without one, it only reads.
  prompt(copy: string | null): string {
    const { rules, files, skill, requests, earlier, candidates, history } = this.fields

    return [
      'You are reviewing a change that another agent made in this repository. You did not write it.',
      'Judge it against the rules below, and against nothing else.',
      ...this.access(copy),
      ...this.section(
        'Rules',
        rules.map((rule) => `- ${rule.id}: ${rule.statement}${this.notes(rule)}`),
      ),
      ...this.section('How this project wants its changes reviewed', skill === null ? [] : [`Read ${skill} first, and follow it.`]),
      ...this.section(
        'What the owner asked for',
        requests.map((request, index) => `${String(index + 1)}. ${request}`),
      ),
      ...this.section('The change', [
        'Changed files, with the lines the change added or modified:',
        '',
        ...files.map((file) => this.listing(file)),
        '',
        ...this.shown(),
      ]),
      ...this.listed(
        'Places to judge',
        'A program of this project listed these places. Judge each one under its rule: a place that respects the rule is not a finding. They do not replace your own reading of the change.',
        candidates,
      ),
      ...this.listed(
        'What an earlier review found',
        'The author was sent back to work with these points, and answered each one. Report again the ones that still hold, and leave out the ones that are fixed. A point answered `not fixed` was decided: raise it again only if the change no longer gives the reason it was kept for.',
        earlier,
      ),
      ...this.listed(
        'What is already known about these files',
        'Each line is a card kept for the owner: something an agent flagged or a review left there, with where it stands. Check that none of these came back. A point the author left with a reason, or that the owner closed, was decided: raise it again only if this change removes the reason.',
        history,
      ),
      ...this.section('Your answer', [
        'The author will answer each finding once: fixed, or not fixed with a reason.',
        '',
        '- `summary`: what you looked at, in two or three sentences.',
        `- \`findings\`: only what breaks one of the rules above, in what this change added or modified. At most ${String(FINDINGS_LIMIT)}, the most serious first. Each one names the rule, the file as it is written in the list of changed files, and the line. \`quote\` is the exact text of that line. \`problem\` says what breaks the rule, \`suggestion\` what to do about it. \`evidence\` is the experiment that shows it, what you ran and what you saw, when the finding is about what the code does; null when it is a judgement on the code as written.`,
        '- `suspicions`: what you suspect and could not verify. The owner reads these, the author does not. A guess is never a finding.',
        '- `experiments`: every command you ran to verify something, with what you observed. Empty when you only read.',
        '',
        'A change that respects the rules has no finding.',
      ]),
    ].join('\n')
  }

  // Both runtimes hold the answer to this shape, so every field is required and one that has nothing to say is null.
  schema(): AnswerSchema {
    const finding = this.shape({
      rule: { type: 'string', enum: this.rules.map((rule) => rule.id) },
      file: TEXT,
      line: { type: ['integer', 'null'] },
      quote: TEXT_OR_NONE,
      problem: TEXT,
      suggestion: TEXT_OR_NONE,
      evidence: TEXT_OR_NONE,
    })

    return this.shape({
      summary: TEXT,
      findings: { type: 'array', items: finding },
      suspicions: { type: 'array', items: this.shape({ file: TEXT_OR_NONE, note: TEXT }) },
      experiments: { type: 'array', items: this.shape({ command: TEXT, observed: TEXT }) },
    })
  }

  private shape(properties: Readonly<Record<string, unknown>>): AnswerSchema {
    return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties }
  }

  private access(copy: string | null): string[] {
    return copy === null
      ? ['Do not change any file: you may only read.']
      : [
          `You work in a copy of the repository as the change left it, at ${copy}. Inside this copy you may do anything: read, write, run the tests, add a throwaway test, print a value. Nothing there is kept, and you never write outside it.`,
          'Experiment rather than speculate: what you can run, you do not have to guess.',
        ]
  }

  private notes(rule: ReviewCriterion): string {
    return rule.evidence ? ' A finding under this rule needs the experiment that shows it.' : ''
  }

  private section(title: string, lines: readonly string[]): string[] {
    return lines.length === 0 ? [] : ['', `## ${title}`, '', ...lines]
  }

  private listed(title: string, how: string, lines: readonly string[]): string[] {
    return this.section(title, lines.length === 0 ? [] : [how, '', ...lines.map((line) => `- ${line}`)])
  }

  private listing(file: ChangedFile): string {
    const path = file.oldPath === file.path ? file.path : `${file.oldPath} -> ${file.path}`
    const ranges = file.added.map(([from, to]) => (from === to ? String(from) : `${String(from)}-${String(to)}`))

    return `- ${file.status} ${path}${ranges.length === 0 ? '' : `: lines ${ranges.join(', ')}`}`
  }

  private shown(): string[] {
    const { patch } = this.fields

    return patch.length <= PATCH_LIMIT
      ? ['Each line of the diff carries its number in the new file.', '', '```diff', patch, '```']
      : ['The patch is too long to show here: read the changed files, and compare them with `git diff` when you need to.']
  }
}
