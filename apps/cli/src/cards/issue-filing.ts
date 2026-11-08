import { spawnSync } from 'node:child_process'
import type { Card, CardRegistry } from '@weaver/memory'
import { IssueBody } from './issue-body.ts'

const LABELS = '{labels}'

// Where issues live is the project's business: it names the command that files one. What the command prints is the
// only trace of the issue Weaver has.
export class IssueFiling {
  private readonly line: readonly string[]
  private readonly top: string
  private readonly registry: CardRegistry | null

  // `line` is the command of the project, with `{title}`, `{body}` and `{labels}` where the card goes.
  constructor(line: readonly string[], top: string, registry: CardRegistry | null = null) {
    this.registry = registry
    this.line = line
    this.top = top
  }

  // What the command printed; null when it printed nothing.
  file(card: Card, reason: string | null = null): string | null {
    const words = this.words(card, reason)
    const attempt = this.registry?.beginIssue(card.number, words)
    if (attempt?.status === 'succeeded') return attempt.output
    const [command = '', ...args] = words
    const result = spawnSync(command, args, { cwd: this.top, encoding: 'utf8' })
    const printed = (result.stdout || '').trim()

    if (result.status !== 0) {
      const why = (result.stderr || result.error?.message || `${command} ended with the status ${String(result.status)}`).trim()

      if (result.signal === null) this.registry?.finishIssue(card.number, 'failed', why)
      throw new Error(`the issue was not filed, and card #${String(card.number)} stays open: ${why}`)
    }

    this.registry?.finishIssue(card.number, 'succeeded', printed === '' ? null : printed)
    return printed === '' ? null : printed
  }

  private words(card: Card, reason: string | null): string[] {
    const labels = card.labels()
    const values: Readonly<Record<string, string>> = {
      title: card.title,
      body: new IssueBody(this.registry).text(card, reason),
      labels: labels.join(','),
    }
    // A card without labels asks for none: `{labels}` goes, and with it the option it was the value of.
    const kept =
      labels.length > 0
        ? this.line
        : this.line.filter((word, index) => !word.includes(LABELS) && !(word.startsWith('-') && this.line[index + 1] === LABELS))

    return kept.map((word) => word.replace(/\{(title|body|labels)\}/g, (_, name: string) => values[name] ?? ''))
  }
}
