import { ProjectSkill } from './project-skill.ts'

const HOLDS: Readonly<Record<string, string>> = {
  Observation: 'What was seen, and where, with what was expected instead.',
  Context: 'What the one who found it was doing, what the owner had asked for, and why it matters.',
  Trace: 'How the one who found it came across it.',
  Uncertainties: 'What was not verified, and what you could not confirm when you looked at the place.',
}

export class CardSkill extends ProjectSkill {
  static readonly PATH = '.weaver/skills/wv-card.md'

  override readonly purpose = 'it tells the writer how this project wants its cards written.'
  // What the header of the skill lists, or what a new skill starts with.
  private readonly sections: readonly string[]

  constructor(top: string, path: string, sections: readonly string[]) {
    super(top, path)
    this.sections = sections
  }

  protected override template(): string {
    return [
      '---',
      'description: How this project wants its cards written. Weaver names this file to the writer it starts at the end of a turn, to turn the flags of that turn into cards.',
      'sections:',
      ...this.sections.map((section) => `  - ${section}`),
      '---',
      '',
      'You write the cards of this project. A flag is the raw report of something an agent or the owner found and left aside. A card is what the owner reads to decide on it: fix it, open an issue, or leave it. Weaver gives you each flag with the lines it points at, what the owner had asked for, and the cards already known on the same files. This file says how this project wants its cards written.',
      '',
      '## What a card is',
      '',
      '- A card is understood alone, months later, by someone who never saw the session it comes from: name the files, say what the code does there, and give the context the flag takes for granted.',
      '- A card is neither an investigation nor a certainty. Look at the place to see whether what the flag says is true, and say what you read. Reproducing the problem, finding its cause and proposing a fix come afterwards, if the owner opens an issue.',
      '- Keep what was seen apart from what is concluded: a fact read in the code is written as a fact, and what someone infers from it is written as their reading of it.',
      '',
      '## The sections',
      '',
      'The body of a card is made of the sections the header of this file lists, in this order.',
      '',
      ...this.sections.map((section) => `- **${section}**: ${HOLDS[section] ?? 'Say here what this section holds.'}`),
      '',
      '## How to write',
      '',
      '- The title says the thing in one short line, without the name of the one who found it.',
      '- Use a GitHub callout, such as `> [!NOTE]` or `> [!WARNING]`, and a mermaid diagram where they help the reader, and nowhere else.',
      '- No emoji.',
      '',
      '## What this project cares about',
      '',
      'Say here what a writer must know about this project: the language its cards are written in, how its labels are chosen, what is fragile and deserves more context.',
      '',
      '- This file is the project owner’s: describe the change you need rather than editing it.',
      '',
    ].join('\n')
  }
}
