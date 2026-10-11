import { ProjectSkill } from './project-skill.ts'

export class ReviewSkill extends ProjectSkill {
  static readonly PATH = '.agents/skills/wv-review.md'

  override readonly purpose = 'it tells the reviewer how this project wants its changes reviewed.'

  protected override template(): string {
    return [
      '---',
      'description: How this project wants its changes reviewed. Weaver names this file to the reviewer it starts once the checks of a task pass.',
      '---',
      '',
      'You review a change that another agent made here. Weaver gives you the rules to judge it against, what the owner asked for, and the change itself. This file says how this project wants the review done.',
      '',
      '## What to read',
      '',
      '- Read each changed file in full, not only the lines of the diff.',
      '- When a rule names a document, read it before you judge against that rule.',
      '',
      '## What counts as a finding',
      '',
      '- A finding is a place where the change breaks one of the rules you were given, and that you verified.',
      '- A finding about what the code does, such as a wrong result, carries the experiment that shows it. What you could not verify is a suspicion: the owner reads it, the author does not.',
      '- Leave out taste, what a linter or a test already settles, and what the change did not touch.',
      '',
      '## What you may run',
      '',
      'This section matters when `review.experiments` is on in `weaver.config.json`: you then work in a copy of the project, where you may write and run what you need. Say here what a reviewer may reach beyond that copy, such as a development stack that is already running, and what it must never start or touch.',
      '',
      '## What this project cares about',
      '',
      'Say here what a reviewer must know about this project: where its conventions are written, what was decided and must not be questioned again, what is fragile.',
      '',
      '- This file is the project owner’s: describe the change you need rather than editing it.',
      '',
    ].join('\n')
  }
}
