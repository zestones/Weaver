import type { CardRecord, Provenance, ReviewContent, WrittenCard } from '../../src/cards/card-record.ts'
import type { FlagRecord, PlaceContext } from '../../src/flags/flag-record.ts'
import { FlagText } from '../../src/flags/flag-text.ts'
import type { NewFlag, NewReviewCard } from '../../src/registry/card-registry.ts'

export const FLAG_BODY = [
  'Seen: no call of refresh() exists under src/.',
  'Expected: the token is refreshed before a request goes out.',
  'Found: I was looking for the callers of getToken for my task.',
  'Checked: grep over src/. I did not run the application.',
  'Did: left as it is.',
].join('\n')

export function provenanceOf(fields: Partial<Provenance> = {}): Provenance {
  return {
    author: 'claude',
    role: 'author',
    session: 'session-1',
    subagent: null,
    unit: 1,
    requests: ['refresh the token before it expires'],
    commit: '3f9a2c1',
    at: '2026-10-11T10:00:00.000Z',
    ...fields,
  }
}

export function contextOf(fields: Partial<PlaceContext> = {}): PlaceContext {
  return {
    place: { file: 'src/auth/token.ts', line: 42 },
    exists: true,
    excerpt: '41  export function getToken() {\n42    return cached\n43  }',
    lineText: '  return cached',
    origin: 'before',
    wroteBy: [{ hash: 'a1b2c3d', date: '2026-09-01', subject: 'feat: cache the token' }],
    lastCommits: [{ hash: 'e4f5a6b', date: '2026-10-02', subject: 'refactor: move the session' }],
    ...fields,
  }
}

export function flagRecordOf(body: string = FLAG_BODY, context: readonly PlaceContext[] = []): FlagRecord {
  const fields = new FlagText(body).fields()

  if (fields === null) throw new Error('the body of this fixture is not a flag')

  return { fields, text: body, context }
}

export function flagOf(fields: Partial<NewFlag> = {}): NewFlag {
  return {
    callId: null,
    places: [{ file: 'src/auth/token.ts', line: 42 }],
    ...flagRecordOf(),
    provenance: provenanceOf(),
    ...fields,
  }
}

export function reviewOf(fields: Partial<ReviewContent> = {}): ReviewContent {
  return {
    review: '3f9a2c1/F1',
    rule: 'N2',
    statement: 'No cast of external data.',
    message: 'The response is cast to User without being parsed.',
    quote: 'const user = raw as User',
    suggestion: 'Parse it with the schema of the user.',
    evidence: null,
    standing: 'not fixed by the agent: the owner asked for it',
    ...fields,
  }
}

export function findingOf(content: Partial<ReviewContent> = {}, fields: Partial<NewReviewCard> = {}): NewReviewCard {
  return {
    origin: 'finding',
    places: [{ file: 'src/api/user.ts', line: 7 }],
    content: reviewOf(content),
    provenance: provenanceOf({ author: 'codex', role: 'reviewer' }),
    ...fields,
  }
}

export function writtenOf(fields: Partial<WrittenCard> = {}): WrittenCard {
  return {
    title: 'Nothing refreshes the token',
    labels: { type: ['bug'], area: ['auth'] },
    sections: [
      { name: 'Observation', text: 'No call of `refresh()` exists under `src/`.' },
      { name: 'Uncertainties', text: 'The application was not run.' },
    ],
    look: { verdict: 'agrees', note: 'Read src/auth/token.ts: refresh() is defined and never called.' },
    writer: { runtime: 'codex', model: 'gpt-5.5', seconds: 42, costUsd: null },
    at: '2026-10-11T10:05:00.000Z',
    ...fields,
  }
}

export function recordOf(fields: Partial<CardRecord> = {}): CardRecord {
  return {
    number: 12,
    origin: 'flag',
    state: 'raw',
    places: [{ file: 'src/auth/token.ts', line: 42 }],
    provenance: provenanceOf(),
    flag: flagRecordOf(),
    review: null,
    written: null,
    closing: null,
    proposal: null,
    seenSinceClosing: false,
    occurrences: [],
    notes: [],
    ties: [],
    mergedInto: null,
    writing: { attempts: 0, failure: null },
    history: [],
    ...fields,
  }
}
