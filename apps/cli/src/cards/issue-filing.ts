import { spawnSync } from 'node:child_process'
import type { Card } from '@weaver/memory'

const LABELS = '{labels}'

// Where issues live is the project's business: it names the command that files one. What the command prints is the
// only trace of the issue Weaver has.
export class IssueFiling {
  private readonly line: readonly string[]
  private readonly top: string

  // `line` is the command of the project, with `{title}`, `{body}` and `{labels}` where the card goes.
  constructor(line: readonly string[], top: string) {
    this.line = line
    this.top = top
  }

  // What the command printed; null when it printed nothing.
  file(card: Card): string | null {
    const [command = '', ...args] = this.words(card)
    const result = spawnSync(command, args, { cwd: this.top, encoding: 'utf8' })
    const printed = (result.stdout || '').trim()

    if (result.status !== 0) {
      const why = (result.stderr || result.error?.message || `${command} ended with the status ${String(result.status)}`).trim()

      throw new Error(`the issue was not filed, and card #${String(card.number)} stays open: ${why}`)
    }

    return printed === '' ? null : printed
  }

  private words(card: Card): string[] {
    const labels = card.labels()
    const values: Readonly<Record<string, string>> = { title: card.title, body: card.markdown(), labels: labels.join(',') }
    // A card without labels asks for none: `{labels}` goes, and with it the option it was the value of.
    const kept =
      labels.length > 0
        ? this.line
        : this.line.filter((word, index) => !word.includes(LABELS) && !(word.startsWith('-') && this.line[index + 1] === LABELS))

    return kept.map((word) => word.replace(/\{(title|body|labels)\}/g, (_, name: string) => values[name] ?? ''))
  }
}
