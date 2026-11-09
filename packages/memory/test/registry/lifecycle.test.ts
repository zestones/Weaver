import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, test } from 'vitest'
import { CardRegistry } from '../../src/registry/card-registry.ts'
import { MIGRATIONS } from '../../src/registry/registry-schema.ts'
import { findingOf, flagOf, provenanceOf, recordOf, writtenOf } from '../fixtures/cards.ts'
import { registriesIn } from '../fixtures/registries.ts'

const registries = registriesIn('lifecycle')
afterAll(() => registries.discard())

test('resolution follows conclusions, drafts evidence without inventing verification, and raw fixed flags await writing', () => {
  const registry = new CardRegistry(registries.folder())
  const flag = flagOf()
  registry.flag({ ...flag, fields: { ...flag.fields, did: 'fixed', didNote: 'Removed the stale cache' } })
  assert.equal(registry.find(1)?.record.lifecycle?.stage, 'fixed')
  assert.equal(registry.find(1)?.record.proposal, null)
  assert.equal(registry.awaitingWriter(2).length, 1)
  registry.written(1, writtenOf())
  assert.equal(registry.find(1)?.record.proposal?.warning, true)
  registry.note(1, { provenance: provenanceOf(), conclusion: 'needs-owner', text: 'Which expiry should we use?' })
  assert.equal(registry.find(1)?.workflow, 'needs the owner')
  assert.equal(registry.find(1)?.record.proposal, null)
  registry.note(1, {
    provenance: provenanceOf(),
    conclusion: 'confirmed',
    text: 'Cause: cached tokens outlive their expiry\nRan: expiry test fails\nRead: cache.ts\nShows: expiry is never checked',
  })
  assert.equal(registry.find(1)?.record.lifecycle?.stage, 'needs-owner')
  registry.note(1, { provenance: provenanceOf(), conclusion: 'no-decision', text: 'The existing policy specifies one hour' })
  const fix = {
    provenance: provenanceOf(),
    conclusion: 'fixed' as const,
    text: 'Changed: checked expiry in cache.ts\nVerified: pnpm test passed\nLeft: nothing',
  }
  const card = registry.note(1, fix).card
  const proposal = card.record.proposal
  assert.ok(proposal)
  assert.equal(proposal.draftedBy, 'weaver')
  assert.equal(proposal.cause, 'cached tokens outlive their expiry')
  assert.equal(proposal.fix, 'checked expiry in cache.ts')
  assert.equal(proposal.verification, 'pnpm test passed')
  assert.equal(proposal.warning, false)
  assert.deepEqual(proposal.evidence, ['note-1', 'note-2', 'note-3', 'note-4'])
  assert.equal(registry.note(1, fix).known, true)
  assert.deepEqual(registry.find(1)?.record.proposal, proposal)
  registry.note(1, { provenance: provenanceOf(), conclusion: 'unsure', text: 'The new test contradicts the claimed fix' })
  assert.equal(registry.find(1)?.record.lifecycle?.stage, 'investigated')
  assert.equal(registry.find(1)?.record.proposal, null)
  registry.close()
})

test('a newer note or correction invalidates the displayed proposal, and reopening starts a cycle even within the same millisecond', () => {
  const dir = registries.folder()
  const registry = new CardRegistry(dir)
  registry.flag(flagOf())
  registry.written(1, writtenOf())
  const said = { provenance: provenanceOf(), conclusion: 'fixed' as const, text: 'Legacy claim with no test recorded' }
  registry.note(1, said)
  registry.showProposal(1)
  const proposal = registry.shownProposal(1)
  assert.ok(proposal)
  assert.match(proposal.reason, /verification not run/)
  assert.match(proposal.reason, /Legacy claim/)
  const other = new CardRegistry(dir)
  other.correct(1, { title: 'New title' })
  registry.showProposal(1, proposal)
  assert.deepEqual(registry.shownProposal(1), proposal, 'the receipt keeps the displayed snapshot when a change races with display')
  assert.throws(() => registry.acceptProposal(1, proposal), /stale: corrected/)
  const latest = registry.find(1)?.record.proposal
  assert.ok(latest)
  other.note(1, { provenance: provenanceOf(), conclusion: null, text: 'The test result needs checking' })
  assert.throws(() => registry.acceptProposal(1, latest), /stale: noted/)
  const current = registry.find(1)?.record.proposal
  assert.ok(current)
  registry.acceptProposal(1, current)
  assert.deepEqual(registry.find(1)?.record.closing?.proposal, current)
  assert.equal(registry.find(1)?.record.closing?.by?.role, 'owner')
  registry.reopen(1, 'The failure recurred')
  assert.equal(registry.find(1)?.record.lifecycle?.stage, 'uninvestigated')
  assert.equal(registry.find(1)?.record.proposal, null)
  assert.deepEqual(registry.find(1)?.record.history.at(-1)?.closing?.proposal, current)
  registry.note(1, { ...said, text: 'Ran: a new test\nRead: the new code\nShows: the claim was false', conclusion: 'refuted' })
  assert.equal(registry.find(1)?.record.proposal?.as, 'invalid')
  assert.equal(registry.find(1)?.record.lifecycle?.cycle, 1)
  other.close()
  registry.close()
})

test('content revisions keep before and after versions with actor and reason, restore them and reject lost updates', () => {
  const registry = new CardRegistry(registries.folder(), provenanceOf())
  registry.flag(flagOf())
  const original = writtenOf()
  registry.written(1, original)
  const baseline = registry.find(1)?.record.revisions?.[0]
  assert.ok(baseline)
  registry.correct(1, { title: 'Retitled' }, 'More precise')
  registry.correct(1, { labels: { type: ['debt'] } }, 'Reclassified')
  registry.correct(1, { sections: [{ name: 'Problem', text: 'Replacement' }] }, 'New evidence')
  const revisions = registry.find(1)?.record.revisions ?? []
  assert.equal(revisions.length, 4)
  assert.equal(revisions[1]?.before?.title, original.title)
  assert.equal(revisions[3]?.by?.role, 'author')
  assert.equal(revisions[3]?.reason, 'New evidence')
  assert.throws(() => registry.correct(1, { title: 'Lost update' }, 'stale', baseline.revision), /changed since/)
  registry.restore(1, baseline.revision, 'Restore original')
  assert.deepEqual(registry.find(1)?.record.written, original)
  assert.equal(registry.find(1)?.record.revisions?.length, 5)
  registry.close()
})

test('v2 migration preserves cards, notes, closings, ties, occurrences and keys, and derives old proposals', () => {
  const dir = registries.folder()
  mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(join(dir, 'registry.sqlite'))
  for (const sql of MIGRATIONS.slice(0, 2)) db.exec(sql)
  const provenance = provenanceOf()
  const note = { provenance, conclusion: 'fixed' as const, text: 'Old fix without verification' }
  const one = recordOf({
    number: 1,
    state: 'open',
    written: writtenOf(),
    notes: [note],
    ties: [2],
    occurrences: [{ card: 3, provenance, note: 'Same problem' }],
  })
  const two = recordOf({
    number: 2,
    state: 'closed',
    closing: { as: 'wontfix', reason: 'Wanted', issue: null, at: provenance.at },
    ties: [1],
  })
  const three = recordOf({ number: 3, state: 'merged', mergedInto: 1 })
  for (const record of [one, two, three])
    db.prepare(
      'INSERT INTO cards (number, state, origin, session, unit, call_id, review_key, attempts, record) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      record.number,
      record.state,
      record.origin,
      provenance.session,
      1,
      `call-${String(record.number)}`,
      null,
      0,
      JSON.stringify(record),
    )
  const finding = findingOf().content
  db.prepare('INSERT INTO review_points (name, card) VALUES (?, ?)').run(JSON.stringify([finding.review, finding.message]), 2)
  db.exec("INSERT INTO card_files VALUES (1, 'src/auth/token.ts'); INSERT INTO card_labels VALUES (1, 'type:bug'); PRAGMA user_version = 2")
  db.close()
  const registry = new CardRegistry(dir)
  assert.equal(registry.list({ states: ['open', 'closed', 'merged'] }).length, 3)
  const stored = new DatabaseSync(join(dir, 'registry.sqlite'))
  assert.equal(
    stored.prepare("SELECT json_extract(record, '$.lifecycle.stage') AS stage FROM cards WHERE number = 1").get()?.stage,
    'fixed',
  )
  stored.close()
  const migrated = registry.find(1)?.record
  assert.deepEqual(migrated?.ties, one.ties)
  assert.deepEqual(migrated?.occurrences, one.occurrences)
  assert.equal(migrated?.notes[0]?.text, note.text)
  assert.equal(migrated?.notes[0]?.id, 'note-1')
  assert.equal(migrated?.proposal?.as, 'fixed')
  assert.equal(migrated?.proposal?.warning, true)
  assert.deepEqual(migrated?.revisions?.[0]?.after, one.written)
  assert.deepEqual(registry.find(2)?.record.closing, two.closing)
  assert.equal(registry.find(3)?.record.mergedInto, 1)
  assert.equal(registry.flag(flagOf({ callId: 'call-1' })).known, true)
  assert.equal(registry.list({ file: 'src/auth/token.ts', label: 'type:bug' }).length, 1)
  assert.equal(registry.open(findingOf()).number, 2, 'review point identities survive migration')
  registry.open(findingOf({ review: 'new-review/F1' }))
  assert.equal(registry.find(4)?.number, 4)
  registry.close()
})

test('issue attempts survive interruption, require reconciliation, and reuse a successful result', () => {
  const dir = registries.folder()
  const first = new CardRegistry(dir)
  first.flag(flagOf())
  first.beginIssue(1, ['gh', 'issue', 'create'])
  first.close()
  const second = new CardRegistry(dir)
  assert.throws(() => second.beginIssue(1, ['gh', 'issue', 'create']), /interrupted/)
  second.reconcileIssue(1, 'not-filed')
  assert.equal(second.beginIssue(1, ['gh', 'issue', 'create']).status, 'running')
  second.finishIssue(1, 'succeeded', 'https://github.com/org/repo/issues/48')
  assert.equal(second.beginIssue(1, ['gh', 'issue', 'create']).output, 'https://github.com/org/repo/issues/48')
  assert.equal(second.find(1)?.state, 'raw', 'reconciliation never closes a card')
  second.close()
})
