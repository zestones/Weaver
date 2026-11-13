import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import { CardRegistry, FlagText } from '@weaver/memory'
import { ResolutionRelevance } from '../../src/noting/cards/resolution-relevance.ts'
import { ObsoleteCards } from '../../src/noting/cards/obsolete-cards.ts'
import { FLAG_BODY } from '../fixtures/cards.ts'
import { git, makeRepo, writeFiles } from '../fixtures/repo.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-resolution-relevance-'))
let counter = 0
let repo: ReturnType<typeof makeRepo>
let registry: CardRegistry
const by = {
  author: 'claude',
  role: 'author',
  session: 'earlier',
  subagent: null,
  unit: 1,
  requests: [],
  commit: null,
  at: '2026-11-13T10:00:00Z',
} as const
const fields = new FlagText(`${FLAG_BODY}Decision: none\n`).fields()
assert.ok(fields)

beforeEach(() => {
  registry?.close()
  repo = makeRepo(join(scratch, String(++counter)), { 'a.ts': 'before\n', 'b.ts': 'kept\n' })
  registry = new CardRegistry(repo.stateDir)
  registry.flag({
    fields,
    callId: null,
    text: FLAG_BODY,
    places: [{ file: 'a.ts', line: 1 }],
    context: [],
    provenance: { ...by, commit: repo.head() },
  })
})
afterAll(() => {
  registry?.close()
  rmSync(scratch, { recursive: true, force: true })
})

const relevant = (): boolean => {
  const card = registry.find(1)
  assert.ok(card)
  return new ResolutionRelevance(repo).changed(card, registry)
}

test('legacy deferrals compare file content with the note commit, not unrelated commits', () => {
  registry.note(1, { conclusion: 'deferred', text: 'Later', provenance: { ...by, commit: repo.head() } })
  assert.equal(relevant(), false)
  writeFiles(repo.top, { 'b.ts': 'unrelated\n' })
  git(repo.top, ['add', 'b.ts'])
  git(repo.top, ['commit', '-qm', 'unrelated'])
  assert.equal(relevant(), false)
  writeFiles(repo.top, { 'a.ts': 'changed\n' })
  assert.equal(relevant(), true)
})

test('deferral snapshots include uncommitted work and new card evidence makes it relevant again', () => {
  writeFiles(repo.top, { 'a.ts': 'uncommitted\n' })
  registry.note(1, {
    conclusion: 'deferred',
    text: 'Later',
    provenance: { ...by, commit: repo.head() },
    fileBlobs: Object.fromEntries(repo.hashPaths(['a.ts'])),
  })
  assert.equal(relevant(), false)
  registry.note(1, { conclusion: null, text: 'New evidence', provenance: { ...by, session: 'other' } })
  assert.equal(relevant(), true)
})

test('a documented owner question stays quiet even when its files change', () => {
  registry.note(1, { conclusion: 'needs-owner', text: 'Which policy?', provenance: by })
  writeFiles(repo.top, { 'a.ts': 'changed\n' })
  assert.equal(relevant(), false)
})

test('cards whose files were all deleted at HEAD gain invalid proposals even when untouched by the current task', () => {
  git(repo.top, ['rm', 'a.ts'])
  git(repo.top, ['commit', '-qm', 'remove old engine'])
  new ObsoleteCards(repo).draft(registry, by)
  const card = registry.find(1)
  assert.equal(card?.state, 'raw')
  assert.equal(card?.record.proposal?.as, 'invalid')
  assert.match(card?.record.proposal?.reason ?? '', /All referenced files were deleted/)
  assert.equal(card?.record.proposal?.warning, false)
  new ObsoleteCards(repo).draft(registry, by)
  assert.equal(registry.find(1)?.record.notes.length, 1)
})

test('uncommitted deletions, restored files, empty places and never-committed paths do not imply obsolete code', () => {
  rmSync(join(repo.top, 'a.ts'))
  new ObsoleteCards(repo).draft(registry, by)
  assert.equal(registry.find(1)?.record.proposal, null)
  git(repo.top, ['add', '-u'])
  git(repo.top, ['commit', '-qm', 'delete'])
  writeFiles(repo.top, { 'a.ts': 'restored\n' })
  for (const [index, places] of [[], [{ file: 'never.ts', line: null }]].entries()) {
    registry.flag({ fields, callId: String(index), text: `Other ${String(index)}`, places, context: [], provenance: by })
  }
  new ObsoleteCards(repo).draft(registry, by)
  assert.ok(registry.list().every((card) => card.record.proposal === null))
})

test('a card with one surviving file does not get an invalid proposal', () => {
  registry.flag({
    fields,
    callId: 'multiple',
    text: 'Multiple places',
    places: [
      { file: 'a.ts', line: 1 },
      { file: 'b.ts', line: 1 },
    ],
    context: [],
    provenance: by,
  })
  git(repo.top, ['rm', 'a.ts'])
  git(repo.top, ['commit', '-qm', 'delete one file'])
  new ObsoleteCards(repo).draft(registry, by)
  assert.equal(registry.find(2)?.record.proposal, null)
})

test('legacy answers to an explicit owner question suppress it without a prompt receipt', () => {
  registry.flag({
    fields: { ...fields, decision: { kind: 'owner', question: 'Which policy?' } },
    callId: 'owner',
    text: 'Owner question',
    places: [{ file: 'a.ts', line: 1 }],
    context: [],
    provenance: by,
  })
  registry.note(2, { conclusion: null, text: 'The owner question stands.', provenance: { ...by, session: 'answering' } })
  const card = registry.find(2)
  assert.ok(card)
  assert.equal(new ResolutionRelevance(repo).changed(card, registry), false)
})
