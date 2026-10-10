import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const EXPECTS: Readonly<Record<string, string>> = {
  Request: 'What you did for the request, and how you verified it: on the real stack, by tests only, or not at all and why.',
  'To validate':
    'What the owner must decide or check before committing: an exception to a rule, a suppression, a deleted test, a limit you could not remove.',
  'Found along the way': 'What you noticed outside the request. List it here; never do it in the task.',
}
const PLACEHOLDER = 'Say here what this section must hold.'

export class FinishSkill {
  static readonly PATH = '.agents/skills/wv-finish.md'
  static readonly HEADINGS: readonly string[] = Object.keys(EXPECTS)

  readonly path: string
  private readonly file: string
  private readonly headings: readonly string[]

  constructor(top: string, path: string, headings: readonly string[]) {
    this.path = path
    this.file = join(top, path)
    this.headings = headings
  }

  get exists(): boolean {
    return existsSync(this.file)
  }

  // The skill is the owner's once it exists: it is never written over.
  create(): boolean {
    if (this.exists) return false

    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, this.template())

    return true
  }

  missingHeadings(): string[] {
    const lines = readFileSync(this.file, 'utf8')
      .split('\n')
      .map((line) => line.trim())

    return this.headings.filter((heading) => !lines.includes(`## ${heading}`))
  }

  private template(): string {
    const sections = this.headings.map((heading) => `## ${heading}\n\n${EXPECTS[heading] ?? PLACEHOLDER}`).join('\n\n')

    return [
      '---',
      'description: How to end a task that changed files, with the final message Weaver waits for before it checks the work.',
      '---',
      '',
      'When a task changed files, end it with a message made of these sections, in this order. Their headings are the signal that the work is finished: Weaver runs the checks of the project only then. A message without them, such as a question or a progress update, leaves the work open.',
      '',
      '```markdown',
      sections,
      '```',
      '',
      '- Write one point per subject, and nothing under a heading when there is nothing to say.',
      '- When the checks fail, Weaver sends you back with each failure. Fix them, then end again with the same sections.',
      '- This file is the project owner’s: describe the change you need rather than editing it.',
      '',
    ].join('\n')
  }
}
