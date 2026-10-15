import { FlagText, type Card, type CardRegistry } from '@weaver/memory'
import type { Repository } from '../../lib/git/repository.ts'
import { PlaceReader, type WrittenLines } from '../places/place-reader.ts'

export interface FlagRequest {
  // The id of the tool call; null for the owner.
  readonly callId: string | null
  // The places as written: `path`, `path:12`, relative to `cwd`.
  readonly places: readonly string[]
  readonly body: string
  // Where the command runs.
  readonly cwd: string
}

export interface FlagAuthor {
  // 'claude', 'codex' or 'owner'.
  readonly author: string
  readonly role: 'author' | 'owner'
  readonly session: string | null
  readonly subagent: string | null
  readonly unit: number | null
  readonly requests: readonly string[]
  // Left out by the owner.
  readonly written?: WrittenLines
}

export interface FlagAnswer {
  // null when the flag could not be used.
  readonly card: Card | null
  readonly known: boolean
  readonly problems: readonly string[]
  // What the one who flagged reads: the acknowledgement with the number, or what is missing and the format.
  readonly message: string
}

const NO_BODY = 'The flag has no body: the five fields are read from a heredoc after the command.'

// Used by the hook for an agent, and by the CLI for the owner in a terminal.
export class FlagRecorder {
  private readonly repo: Repository
  private readonly registry: CardRegistry

  constructor(repo: Repository, registry: CardRegistry) {
    this.repo = repo
    this.registry = registry
  }

  record(request: FlagRequest, by: FlagAuthor): FlagAnswer {
    const text = new FlagText(request.body)
    const fields = text.fields()

    if (fields === null) return this.unusable(request.body.trim() === '' ? [NO_BODY] : text.problems())

    const reader = new PlaceReader(this.repo, by.written)
    const context = request.places.filter((place) => place.trim() !== '').map((place) => reader.read(place, request.cwd))
    const { author, role, session, subagent, unit, requests } = by
    const { card, known } = this.registry.flag({
      callId: request.callId,
      places: context.map(({ place }) => place),
      fields,
      text: request.body,
      context,
      provenance: { author, role, session, subagent, unit, requests, commit: this.repo.head(), at: new Date().toISOString() },
    })
    const number = String(card.number)
    const missing = context.filter((place) => !place.exists).map(({ place }) => place.file)
    const kept =
      missing.length === 0
        ? ''
        : ` ${missing.join(', ')}: no such file in the repository, neither from where the command ran nor from its top. The card keeps the place as it was written.`

    return {
      card,
      known,
      problems: [],
      message: known
        ? `[weaver] This flag is already recorded as ${number}. Go on with your task.`
        : `[weaver] Flag ${number} recorded for the owner.${kept} This command is answered here and never runs: that is expected. Go on with your task.`,
    }
  }

  private unusable(problems: readonly string[]): FlagAnswer {
    return {
      card: null,
      known: false,
      problems,
      message: `[weaver] The flag was not recorded: ${problems.join(' ')}\n\n${FlagText.FORMAT}`,
    }
  }
}
