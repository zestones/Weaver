import type { Declaration } from '../../declaration/content/declaration.ts'

// What an agent is told with every request: one line for each moment a command of Weaver is for, so that it comes to
// mind then. A message given once would not survive a compacted context. How to do each is in the guide.
export class RequestBriefing {
  readonly text: string

  constructor(declaration: Declaration) {
    const checks = declaration.checks.map((check) => check.id)
    const headings = declaration.finish.headings ?? []

    this.text = [
      '[weaver] Weaver supervises this repository: it checks your work when your task ends, and keeps for the owner, as cards, what agents find. Its commands, each at its moment:',
      '- before you change a file: `weaver cards --file <path>` or `--search <words>`, what the owner already knows of it;',
      '- something your task does not settle: `weaver flag` it;',
      ...(checks.length === 0 ? [] : [`- a check's verdict before the end: \`weaver check <name>\`, among ${checks.join(', ')};`]),
      '- a card your task settles or advances: `weaver note <number>`, what you looked into, then what you changed;',
      ...(headings.length === 0
        ? []
        : [`- the end of a task that changed files: a final message with ${headings.map((heading) => `## ${heading}`).join(', ')}.`]),
      'How to do each, and what is the owner’s alone: `weaver guide`.',
    ].join('\n')
  }
}
