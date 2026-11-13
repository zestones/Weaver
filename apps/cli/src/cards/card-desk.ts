import { DeclarationParts, NoteRecorder } from '@weaver/engine'
import {
  LabelFamilies,
  type Card,
  type CardRegistry,
  type CardState,
  type Closing,
  type ClosingProposal,
  type Conclusion,
  type LabelCatalog,
} from '@weaver/memory'
import type { Project } from '../project/project.ts'
import { IssueFiling } from './issue-filing.ts'

const EVERY_STATE: readonly CardState[] = ['raw', 'open', 'closed', 'merged']

// What the owner does to the cards of a project, in one place. The commands and the interface both go through it:
// neither can do what the other cannot.
export class CardDesk {
  private readonly project: Project
  private readonly registry: CardRegistry
  private declared: LabelCatalog | null = null

  constructor(project: Project, registry: CardRegistry) {
    this.project = project
    this.registry = registry
  }

  // The labels the project declares; none when its declaration cannot be read.
  get labels(): LabelCatalog {
    this.declared ??= this.project.readableDeclaration()?.labels ?? {}

    return this.declared
  }

  // The families of labels, in the order they are shown.
  get families(): LabelFamilies {
    return new LabelFamilies(Object.keys(this.labels))
  }

  // The values of the family the project grades its cards with, gravest first; empty when it declares none.
  get scale(): readonly string[] {
    return Object.keys(this.labels[LabelFamilies.LEVEL] ?? {})
  }

  // Every card, whatever its state.
  cards(): Card[] {
    return this.registry.list({ states: EVERY_STATE })
  }

  get canClose(): boolean {
    return this.registry.actor.role === 'owner'
  }

  closeProposed(proposals: readonly { readonly number: number; readonly proposal: ClosingProposal }[]): void {
    if (!this.canClose) throw new Error("closing a card is the owner's")
    this.registry.acceptProposals(proposals)
  }

  close(number: number, closing: Closing | null = null, reason: string | null = null, proposal?: ClosingProposal): string {
    if (!this.canClose) throw new Error("closing a card is the owner's")
    if (closing === null) {
      const current = proposal ?? this.registry.shownProposal(number) ?? this.registry.find(number)?.record.proposal
      if (current == null) throw new Error('this card has no closing proposal; give a disposition or record a conclusion first')
      this.registry.acceptProposal(number, current)
      return `Card #${String(number)} closed as ${current.as}.`
    }
    const closed = `Card #${String(number)} closed as ${closing}`
    const card = this.registry.find(number)
    // A card that cannot be closed is not filed either: the registry says why when it is asked to close it.
    const line = closing === 'issue' && card?.isWaiting === true ? (this.project.declaration()?.issue ?? null) : null
    const printed = card === null || line === null ? null : new IssueFiling(line, this.project.top, this.registry).file(card, reason)

    this.registry.closeCard(number, closing, reason, printed)

    if (closing === 'issue' && line === null) {
      return `${closed}, which is only recorded: ${this.project.configName}/${DeclarationParts.FILES.issues} names no command that files one.`
    }

    return printed === null ? `${closed}.` : `${closed}: ${printed}`
  }

  note(number: number, conclusion: Conclusion | null, text: string): Card {
    const { card, problems } = new NoteRecorder(this.project.repository, this.registry).record(
      { words: [String(number), ...(conclusion === null ? [] : [conclusion])], body: text },
      { ...this.registry.actor, role: this.registry.actor.role === 'owner' ? 'owner' : 'author' },
    )

    if (card === null) throw new Error(problems.join(' '))

    return card
  }

  // The labels of a card, family by family: the families named are replaced, the others kept.
  relabel(number: number, labels: Readonly<Record<string, readonly string[]>>): Card {
    const card = this.registry.find(number)
    const kept = Object.entries({ ...card?.record.written?.labels, ...labels }).filter(([, values]) => values.length > 0)

    return this.registry.correct(number, { labels: Object.fromEntries(kept) }, undefined, card?.record.lifecycle?.revision)
  }
}
