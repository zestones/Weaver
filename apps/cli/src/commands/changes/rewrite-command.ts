import type { Input } from '../../input/input.ts'
import type { Output } from '../../output/output.ts'
import { CardChange, type RegistryChange } from './card-change.ts'

interface Section {
  readonly name: string
  readonly text: string
}

export class RewriteCommand extends CardChange {
  override readonly name = 'cards rewrite'
  override readonly usage = 'cards rewrite <number>'
  override readonly summary = 'Replace the sections of a card'
  override readonly help = {
    group: 'Cards',
    description: 'Replace the sections of a card with the Markdown read on the standard input, cut at its "## " headings.',
    words: [['<number>', 'The number of the card, as weaver cards shows it']],
    examples: ['weaver cards rewrite 12 < card.md'],
  } as const
  private readonly input: Input

  constructor(cwd: string, output: Output, input: Input) {
    super(cwd, output)
    this.input = input
  }

  protected override change([number = 0]: readonly number[], words: readonly string[]): RegistryChange | null {
    if (words.length > 0) return null

    const sections = this.sections(this.input.read())

    return (registry) => {
      registry.correct(number, { sections })

      return `Card #${String(number)} is rewritten, with the sections ${sections.map((section) => section.name).join(', ')}.`
    }
  }

  private sections(text: string): Section[] {
    const sections: { readonly name: string; readonly lines: string[] }[] = []
    let fenced = false

    for (const line of text.split(/\r?\n/)) {
      // A line of code that starts with `## ` is not a heading.
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced

      const [, name] = fenced ? [] : (/^## +(.*\S)\s*$/.exec(line) ?? [])

      if (name !== undefined) sections.push({ name, lines: [] })
      else if (sections.length > 0) sections.at(-1)?.lines.push(line)
      else if (line.trim() !== '') throw new Error('the text read starts before its first "## " heading: those lines belong to no section')
    }

    if (sections.length === 0) throw new Error('the text read has no "## " heading: each section starts with one')

    return sections.map(({ name, lines }) => ({ name, text: lines.join('\n').trim() }))
  }
}
