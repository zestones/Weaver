import assert from 'node:assert/strict'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, test, vi } from 'vitest'
import { Card } from '../../src/cards/card.ts'
import { CardRegistry } from '../../src/registry/card-registry.ts'
import { flagOf, provenanceOf, recordOf, writtenOf } from '../fixtures/cards.ts'
import { registriesIn } from '../fixtures/registries.ts'

const registries = registriesIn('resolution')
afterAll(() => registries.discard())

test('explicit owner decisions survive writer suggestions and investigations until explicitly changed', () => {
  const registry = new CardRegistry(registries.folder())
  const flag = flagOf()
  registry.flag({ ...flag, fields: { ...flag.fields, decision: { kind: 'owner', question: 'Which expiry?' } } })
  registry.written(1, writtenOf({ decision: { kind: 'none', question: null } }))
  assert.deepEqual(registry.find(1)?.decision, { kind: 'owner', question: 'Which expiry?' })
  registry.note(1, { provenance: provenanceOf(), conclusion: 'confirmed', text: 'The cache is stale' })
  assert.equal(registry.find(1)?.workflow, 'needs the owner')
  registry.note(1, { provenance: provenanceOf(), conclusion: 'fixed', text: 'Fixed the cache' })
  assert.equal(registry.find(1)?.record.proposal, null)
  registry.note(1, { provenance: provenanceOf(), conclusion: 'no-decision', text: 'Existing policy gives the expiry' })
  assert.equal(registry.find(1)?.decision.kind, 'none')
  assert.equal(registry.find(1)?.record.proposal?.as, 'fixed')
  assert.match(registry.find(1)?.markdown() ?? '', /Decision: none/)
  registry.close()
})

test('older flags are unknown, writers may suggest unknown decisions and later notes win', () => {
  const record = recordOf()
  assert.equal(new Card({ ...record, flag: null }).decision.kind, 'unknown')
  const registry = new CardRegistry(registries.folder())
  registry.flag(flagOf())
  assert.equal(registry.find(1)?.decision.kind, 'unknown')
  registry.written(1, writtenOf({ decision: { kind: 'none', question: null } }))
  assert.equal(registry.find(1)?.workflow, 'actionable')
  registry.note(1, { provenance: provenanceOf(), conclusion: 'needs-owner', text: 'Choose a policy' })
  registry.note(1, { provenance: provenanceOf(), conclusion: 'unsure', text: 'Still investigating' })
  assert.deepEqual(registry.find(1)?.decision, { kind: 'owner', question: 'Choose a policy' })
  assert.equal(registry.find(1)?.record.lifecycle?.stage, 'needs-owner')
  registry.close()
})

test('claims honor the limit atomically across connections, last one hour and release', () => {
  const dir = registries.folder()
  const first = new CardRegistry(dir)
  const second = new CardRegistry(dir)
  for (let n = 1; n <= 5; n++) {
    const flag = flagOf({ callId: `flag-${String(n)}`, text: `flag ${String(n)}` })
    first.flag({
      ...flag,
      fields: { ...flag.fields, decision: { kind: n === 4 ? 'owner' : n === 5 ? 'unknown' : 'none', question: n === 4 ? 'Which?' : null } },
    })
  }
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000)
  try {
    assert.deepEqual(
      first.claimResolution([1, 2, 3, 4, 5], 'first', 2).map((card) => card.number),
      [1, 2],
    )
    assert.deepEqual(
      second.claimResolution([1, 2, 3, 4, 5], 'second', 2).map((card) => card.number),
      [3],
    )
    assert.deepEqual(second.claimResolution([1, 2], 'second', 2), [])
    now.mockReturnValue(601001)
    assert.deepEqual(second.claimResolution([1, 2], 'second', null), [], 'claims outlast ten minutes')
    now.mockReturnValue(3600999)
    assert.deepEqual(second.claimResolution([1, 2], 'second', null), [], 'claims last the full hour')
    now.mockReturnValue(3601000)
    assert.deepEqual(
      second.claimResolution([1, 2], 'second', 2).map((card) => card.number),
      [1, 2],
    )
    first.releaseResolution('first')
    assert.deepEqual(first.claimResolution([1, 2], 'first', 2), [], 'an old holder cannot release a newer claim')
    second.releaseResolution('second')
    assert.equal(first.claimResolution([1, 2], 'first', 2).length, 2)
  } finally {
    now.mockRestore()
    first.close()
    second.close()
  }
})

test('version 4 upgrades decisions and claims without losing any registry content', () => {
  const dir = registries.folder()
  const before = new CardRegistry(dir)
  before.flag(flagOf())
  before.written(1, writtenOf())
  before.note(1, { provenance: provenanceOf(), conclusion: null, text: 'Keep this evidence' })
  before.flag(flagOf({ callId: 'second', text: 'Another flag' }))
  before.tie(1, 2, 'Related')
  before.closeCard(2, 'wontfix', 'Keep the existing behavior')
  before.publishReview('receipt', 'session', [])
  const records = before.list({ states: ['open', 'closed'] }).map((card) => card.record)
  before.close()
  const old = new DatabaseSync(join(dir, 'registry.sqlite'))
  old.exec(
    "DROP TABLE resolution_questions; DROP TABLE resolution_claims; UPDATE cards SET record = json_remove(record, '$.flag.fields.decision'); PRAGMA user_version = 4",
  )
  old.close()
  const after = new CardRegistry(dir)
  assert.deepEqual(
    after.list({ states: ['open', 'closed'] }).map((card) => card.record),
    records,
  )
  assert.equal(after.find(1)?.decision.kind, 'unknown')
  assert.equal(after.find(2)?.record.closing?.reason, 'Keep the existing behavior')
  assert.equal(after.claimResolution([1], 'later', 2).length, 0)
  const db = new DatabaseSync(join(dir, 'registry.sqlite'))
  assert.equal(db.prepare('PRAGMA user_version').get()?.user_version, 6)
  assert.equal(db.prepare('SELECT count(*) AS total FROM review_deliveries').get()?.total, 1)
  db.close()
  after.close()
})

for (const limit of [null, 1, 0]) {
  test(`claims with limit ${String(limit)} select the eligible cards`, () => {
    const registry = new CardRegistry(registries.folder())
    try {
      for (let n = 1; n <= 5; n++) {
        const flag = flagOf({ callId: `flag-${String(n)}`, text: `flag ${String(n)}` })
        registry.flag({
          ...flag,
          fields: {
            ...flag.fields,
            decision: { kind: n === 4 ? 'owner' : n === 5 ? 'unknown' : 'none', question: n === 4 ? 'Which?' : null },
          },
        })
      }
      const expected = limit === null ? [1, 2, 3] : limit === 1 ? [1] : []
      assert.deepEqual(
        registry.claimResolution([1, 2, 3, 4, 5], 'holder', limit).map((card) => card.number),
        expected,
      )
      assert.deepEqual(
        registry.claimResolution([1, 2, 3, 4, 5], 'parallel', null).map((card) => card.number),
        [1, 2, 3].filter((number) => !expected.includes(number)),
      )
    } finally {
      registry.close()
    }
  })
}

test('stored writer decisions remain claimable after reopening a registry without changing explicit decisions', () => {
  const dir = registries.folder()
  const first = new CardRegistry(dir)
  for (const [index, kind] of ['unknown', 'owner', 'none'].entries()) {
    const flag = flagOf({ callId: `writer-${String(index)}`, text: `Writer ${String(index)}` })
    first.flag({
      ...flag,
      fields: { ...flag.fields, decision: { kind: kind as 'unknown' | 'owner' | 'none', question: kind === 'owner' ? 'Which?' : null } },
    })
    first.written(
      index + 1,
      writtenOf({ decision: { kind: index === 2 ? 'owner' : 'none', question: index === 2 ? 'Suggestion only' : null } }),
    )
  }
  first.close()
  const older = new DatabaseSync(join(dir, 'registry.sqlite'))
  older.exec('DROP TABLE resolution_questions; PRAGMA user_version = 5')
  older.close()
  const registry = new CardRegistry(dir)
  assert.deepEqual(
    registry.claimResolution([1, 2, 3], 'next-session', null).map((card) => card.number),
    [1, 3],
  )
  assert.equal(registry.find(1)?.record.flag?.fields.decision?.kind, 'unknown')
  assert.equal(registry.find(1)?.record.written?.decision?.kind, 'none')
  assert.equal(registry.find(2)?.decision.kind, 'owner')
  const owner = registry.find(2)
  assert.ok(owner)
  assert.equal(registry.ownerQuestionAsked(owner), false)
  registry.rememberOwnerQuestion(owner)
  registry.close()
  const next = new CardRegistry(dir)
  assert.equal(next.ownerQuestionAsked(owner), true)
  next.note(2, { provenance: provenanceOf(), conclusion: 'needs-owner', text: 'A different question?' })
  const changed = next.find(2)
  assert.ok(changed)
  assert.equal(next.ownerQuestionAsked(changed), false)
  next.close()
})
