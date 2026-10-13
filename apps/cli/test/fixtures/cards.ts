import { Repository } from '@weaver/engine'
import {
  CardRegistry,
  FlagText,
  type Card,
  type CardNote,
  type NewFlag,
  type NewReviewCard,
  type PlaceContext,
  type ReviewContent,
  type WrittenCard,
} from '@weaver/memory'

export const FLAG_BODY = [
  'Seen: no call of refresh() exists under src/.',
  'Expected: the token is refreshed before a request goes out.',
  'Found: I was looking for the callers of getToken for my task.',
  'Checked: grep over src/. I did not run the application.',
  'Did: left as it is.',
].join('\n')

const PROVENANCE = {
  author: 'claude',
  role: 'author',
  session: 'session-1',
  subagent: null,
  unit: 1,
  requests: ['refresh the token before it expires'],
  commit: null,
  at: '2026-10-11T10:00:00.000Z',
} as const

// The registry of a project, open for the time of `work`.
export function inRegistry<Result>(top: string, work: (registry: CardRegistry) => Result): Result {
  const repo = Repository.locate(top)

  if (repo === null) throw new Error(`${top} is not a repository`)

  const registry = new CardRegistry(repo.stateDir)

  try {
    return work(registry)
  } finally {
    registry.close()
  }
}

export function cardOf(top: string, number: number): Card {
  const card = inRegistry(top, (registry) => registry.find(number))

  if (card === null) throw new Error(`no card has the number ${String(number)}`)

  return card
}

export function contextOf(file: string, line: number, lineText: string): PlaceContext {
  return {
    place: { file, line },
    exists: true,
    excerpt: `${String(line)}  ${lineText}`,
    lineText,
    origin: 'before',
    wroteBy: [],
    lastCommits: [],
  }
}

// A flag of an agent, as the hook records it: the number of its card.
export function flag(top: string, given: Partial<NewFlag> = {}): number {
  const fields = new FlagText(given.text ?? FLAG_BODY).fields()

  if (fields === null) throw new Error('the body of this fixture is not a flag')

  return inRegistry(top, (registry) =>
    registry.flag({
      callId: null,
      places: [{ file: 'src/auth/token.ts', line: 42 }],
      fields,
      text: FLAG_BODY,
      context: [],
      provenance: PROVENANCE,
      ...given,
    }),
  ).card.number
}

// What a review left for the owner: the number of its card.
export function finding(top: string, content: Partial<ReviewContent> = {}, given: Partial<NewReviewCard> = {}): number {
  return inRegistry(top, (registry) =>
    registry.open({
      origin: 'finding',
      places: [{ file: 'src/api/user.ts', line: 7 }],
      content: {
        review: '3f9a2c1/F1',
        rule: 'N2',
        statement: 'No cast of external data.',
        message: 'The response is cast to User without being parsed.',
        quote: null,
        suggestion: null,
        evidence: null,
        standing: 'not fixed by the agent: the owner asked for it',
        ...content,
      },
      provenance: { ...PROVENANCE, author: 'codex', role: 'reviewer' },
      ...given,
    }),
  ).number
}

// What an agent wrote on a card after looking into it.
export function note(top: string, number: number, given: Partial<CardNote> = {}): void {
  inRegistry(top, (registry) =>
    registry.note(number, {
      provenance: { ...PROVENANCE, session: 'session-2', requests: ['verify card 1'], at: '2026-10-12T09:30:00.000Z' },
      conclusion: 'confirmed',
      text: 'Ran the test with a token of one second:\n\n```text\n401 Unauthorized\n```',
      ...given,
    }),
  )
}

// What the writer made of a flag.
export function write(top: string, number: number, given: Partial<WrittenCard> = {}): void {
  inRegistry(top, (registry) =>
    registry.written(number, {
      title: 'Nothing refreshes the token',
      labels: { type: ['bug'], area: ['auth'] },
      sections: [
        { name: 'Observation', text: 'No call of `refresh()` exists under `src/`.' },
        { name: 'Uncertainties', text: 'The application was not run.' },
      ],
      look: { verdict: 'agrees', note: 'Read src/auth/token.ts: refresh() is defined and never called.' },
      writer: { runtime: 'codex', model: null, seconds: 42, costUsd: null },
      at: '2026-10-11T10:05:00.000Z',
      ...given,
    }),
  )
}
