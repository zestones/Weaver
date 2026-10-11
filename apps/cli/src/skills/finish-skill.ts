import { ProjectSkill } from './project-skill.ts'

const EXPECTS: Readonly<Record<string, string>> = {
  Request: 'What you did for the request, and how you verified it: on the real stack, by tests only, or not at all and why.',
  'To validate':
    'What the owner must decide or check before committing: an exception to a rule, a suppression, a deleted test, a limit you could not remove.',
  'Found along the way': 'What you noticed outside the request. List it here; never do it in the task.',
}
const PLACEHOLDER = 'Say here what this section must hold.'

export class FinishSkill extends ProjectSkill {
  static readonly PATH = '.agents/skills/wv-finish.md'
  static readonly HEADINGS: readonly string[] = Object.keys(EXPECTS)

  override readonly purpose = 'it tells the agent how to end a task.'
  private readonly headings: readonly string[]

  constructor(top: string, path: string, headings: readonly string[]) {
    super(top, path)
    this.headings = headings
  }

  missingHeadings(): string[] {
    const lines = this.lines()

    return this.headings.filter((heading) => !lines.includes(`## ${heading}`))
  }

  protected override template(): string {
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
      '- When a reviewer found points on your change, Weaver sends you back with them, numbered F1, F2 and so on. Fix each one or decide to leave it, then answer each in your final message, one line each: `F1 fixed: <what you changed>` or `F1 not fixed: <why>`.',
      '- This file is the project owner’s: describe the change you need rather than editing it.',
      '',
    ].join('\n')
  }
}
