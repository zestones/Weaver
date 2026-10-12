import { spawnSync } from 'node:child_process'
import { DeclarationParts } from '@weaver/engine'
import type { Card, Closing } from '@weaver/memory'
import type { Project } from '../../project/project.ts'
import { CardChange, type RegistryChange } from './card-change.ts'

const CLOSINGS: readonly Closing[] = ['fixed', 'wontfix', 'issue']
const LABELS = '{labels}'

export class CloseCommand extends CardChange {
  override readonly name = 'close'
  override readonly usage = `close <number> ${CLOSINGS.join('|')} [reason]`
  override readonly summary = 'Close a card'
  override readonly help = {
    group: 'Cards',
    description: 'Close a card: it was fixed, it will not be, or it is now an issue of its own.',
    words: [
      ['<number>', 'The number of the card, as weaver cards shows it'],
      ['fixed|wontfix|issue', 'Why it closes: it was fixed, it will not be, or it becomes an issue of its own'],
      ['[reason]', 'A few words kept with the card'],
    ],
    examples: ['weaver close 12 fixed', 'weaver close 12 wontfix "the old behaviour is wanted"'],
  } as const

  protected override change([number = 0]: readonly number[], [as, ...words]: readonly string[], project: Project): RegistryChange | null {
    const closing = CLOSINGS.find((known) => known === as)

    if (closing === undefined) return null

    return (registry) => {
      const closed = `Card #${String(number)} closed as ${closing}`
      const card = registry.find(number)
      // A card that cannot be closed is not filed either: the registry says why when it is asked to close it.
      const files = closing === 'issue' && card?.isWaiting === true ? (project.declaration()?.issue ?? null) : null
      const printed = card === null || files === null ? null : this.filed(files, card, project.top)

      registry.closeCard(number, closing, words.length === 0 ? null : words.join(' '), printed)

      if (closing === 'issue' && files === null) {
        return `${closed}, which is only recorded: ${project.configName}/${DeclarationParts.FILES.issues} names no command that files one.`
      }

      return printed === null ? `${closed}.` : `${closed}: ${printed}`
    }
  }

  // Where issues live is the project's business: it names the command that files one. What the command prints is the
  // only trace of the issue Weaver has.
  private filed(line: readonly string[], card: Card, top: string): string | null {
    const [command = '', ...args] = this.words(line, card)
    const result = spawnSync(command, args, { cwd: top, encoding: 'utf8' })
    const printed = (result.stdout || '').trim()

    if (result.status !== 0) {
      const why = (result.stderr || result.error?.message || `${command} ended with the status ${String(result.status)}`).trim()

      throw new Error(`the issue was not filed, and card #${String(card.number)} stays open: ${why}`)
    }

    return printed === '' ? null : printed
  }

  private words(line: readonly string[], card: Card): string[] {
    const labels = card.labels()
    const values: Readonly<Record<string, string>> = { title: card.title, body: card.markdown(), labels: labels.join(',') }
    // A card without labels asks for none: `{labels}` goes, and with it the option it was the value of.
    const kept =
      labels.length > 0
        ? line
        : line.filter((word, index) => !word.includes(LABELS) && !(word.startsWith('-') && line[index + 1] === LABELS))

    return kept.map((word) => word.replace(/\{(title|body|labels)\}/g, (_, name: string) => values[name] ?? ''))
  }
}
