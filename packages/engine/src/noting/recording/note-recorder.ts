import { NoteReport, NoteText, RegistryError, type Card, type CardRegistry, type Conclusion } from '@weaver/memory'
import type { Repository } from '../../lib/git/repository.ts'

export interface NoteRequest {
  // What follows the command: the number of the card, what the note concludes, then its text.
  readonly words: readonly string[]
  // What the command was given to read; null when nothing.
  readonly body: string | null
}

export interface NoteAuthor {
  // 'claude', 'codex' or 'owner'.
  readonly author: string
  readonly role: 'author' | 'owner'
  readonly session: string | null
  readonly subagent: string | null
  readonly unit: number | null
  readonly requests: readonly string[]
}

export interface NoteAnswer {
  // null when the note could not be written.
  readonly card: Card | null
  readonly conclusion: Conclusion | null
  readonly known: boolean
  readonly problems: readonly string[]
  // What an agent that wrote the note reads: the acknowledgement, or what is missing and the format.
  readonly message: string
}

// Used by the hook for an agent, and by the CLI for the owner in a terminal.
export class NoteRecorder {
  private readonly repo: Repository
  private readonly registry: CardRegistry

  constructor(repo: Repository, registry: CardRegistry) {
    this.repo = repo
    this.registry = registry
  }

  record(request: NoteRequest, by: NoteAuthor): NoteAnswer {
    const note = new NoteText(request.words, request.body)
    const { card: number, conclusion, text } = note
    // An agent that concludes owes a report, field by field, and a fix only after what it looked into: the owner reads
    // both to decide. The owner writes what they want, and so does an agent that concludes nothing.
    const owed = by.role === 'owner' || conclusion === null || text === '' ? [] : new NoteReport(conclusion, text).problems()
    const problems = [...note.problems(), ...owed]

    if (number === null || problems.length > 0) return this.unusable(problems)
    if (by.role === 'author' && conclusion === 'fixed' && this.registry.find(number)?.isInvestigated === false) {
      return this.unusable([
        `Card ${String(number)} says nothing yet of what was looked into: a fix comes after the investigation. Write first what you ran and read, and what it showed, with confirmed, refuted or unsure, then the fix: both may go in one call, in that order.`,
      ])
    }

    try {
      const provenance = { ...by, commit: this.repo.head(), at: new Date().toISOString() }
      const { card, known } = this.registry.note(number, { provenance, conclusion, text })
      const name = String(card.number)

      return {
        card,
        conclusion,
        known,
        problems: [],
        message: known
          ? `[weaver] This note is already on card ${name}. Go on with your task.`
          : `[weaver] Note written on card ${name} for the owner. This command is answered here and never runs: that is expected. Go on with your task.`,
      }
    } catch (error) {
      // A card that does not exist, or that became another one, is what is wrong with the note. A registry that
      // could not be used carries its cause, and is a failure of Weaver.
      if (!(error instanceof RegistryError) || error.cause !== undefined) throw error

      return this.unusable([`${error.message.charAt(0).toUpperCase()}${error.message.slice(1).replace(/\.$/, '')}.`])
    }
  }

  private unusable(problems: readonly string[]): NoteAnswer {
    return {
      card: null,
      conclusion: null,
      known: false,
      problems,
      message: `[weaver] The note was not written: ${problems.join(' ')}\n\n${NoteText.FORMAT}`,
    }
  }
}
