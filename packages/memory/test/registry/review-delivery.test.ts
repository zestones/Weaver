import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
import { afterAll, test } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { CardRegistry } from '../../src/registry/card-registry.ts'
import { findingOf, flagOf, provenanceOf } from '../fixtures/cards.ts'
import { registriesIn } from '../fixtures/registries.ts'

const registries = registriesIn('delivery')
afterAll(() => registries.discard())

test('publication and notices are atomic, survive reopening and remain idempotent even after closing or wording changes', () => {
  const dir = registries.folder()
  const registry = new CardRegistry(dir)
  const point = { ...findingOf(), identity: JSON.stringify(['session', 'full-hash', 'finding', 1]) }
  registry.publishReview('delivery', 'session', [point])
  registry.closeCard(1, 'wontfix', 'owner decided')
  registry.close()
  const again = new CardRegistry(dir)
  assert.equal(again.publishReview('delivery', 'session', [{ ...point, content: { ...point.content, message: 'reworded' } }])[0]?.number, 1)
  assert.equal(again.reviewNotices('unrelated', []).length, 0)
  assert.equal(
    again.reviewNotices(
      'later',
      point.places.map((place) => place.file),
    ).length,
    1,
  )
  assert.equal(again.reviewNotices('session', []).length, 0)
  assert.equal(again.open({ ...point, content: { ...point.content, message: 'reworded' } }).number, 1)
  assert.equal(again.find(1)?.record.occurrences.length, 0)
  again.close()
})

test('a failure during publication leaves neither partial cards nor a delivery receipt', () => {
  const registry = registries.fresh()
  const point = findingOf()
  assert.throws(() =>
    registry.publishReview('failed', 's', [
      point,
      { ...point, identity: 'broken', provenance: { ...point.provenance, at: 1n } } as unknown as typeof point,
    ]),
  )
  assert.equal(registry.list().length, 0)
  assert.equal(registry.reviewDelivered('failed'), false)
})

test('legacy point mappings are reused, but another session has its own identity', () => {
  const registry = registries.fresh()
  const point = { ...findingOf(), provenance: provenanceOf({ session: 'first' }) }
  registry.open(point)
  const legacyPoint = JSON.stringify([point.content.review, point.content.message])
  registry.publishReview('a', 'first', [{ ...point, legacyPoint, identity: 'full-first' }])
  assert.equal(registry.find(1)?.record.occurrences.length, 0)
  registry.publishReview('b', 'second', [
    { ...point, legacyPoint, identity: 'full-second', provenance: provenanceOf({ session: 'second' }) },
  ])
  assert.equal(registry.find(1)?.record.occurrences.length, 1)
})

test('registry v3 to v4 preserves every existing card and point mapping', () => {
  const dir = registries.folder()
  const registry = new CardRegistry(dir)
  registry.flag(flagOf())
  registry.open(findingOf())
  const before = registry.list().map((card) => card.record)
  registry.close()
  const db = new DatabaseSync(join(dir, 'registry.sqlite'))
  db.exec('DROP TABLE review_deliveries; DROP TABLE recovery_cursor; DROP TABLE writer_batches; PRAGMA user_version = 3')
  db.close()
  const migrated = new CardRegistry(dir)
  assert.deepEqual(
    migrated.list().map((card) => card.record),
    before,
  )
  assert.equal(migrated.open(findingOf()).number, 2)
  assert.equal(migrated.reviewDelivered('absent'), false)
  migrated.close()
})

test('a worker and a hook publishing concurrently create one set of cards and one notice', async () => {
  const dir = registries.folder()
  const point = { ...findingOf(), identity: JSON.stringify(['s', 'full-review-hash', 'finding', 1]) }
  const source = pathToFileURL(join(import.meta.dirname, '../../src/registry/card-registry.ts')).href
  const program = `import { CardRegistry } from ${JSON.stringify(source)}; const registry = new CardRegistry(process.argv[1]); registry.publishReview('same-review', 's', JSON.parse(process.argv[2])); registry.close()`
  await Promise.all(
    Array.from({ length: 3 }, () =>
      promisify(execFile)(process.execPath, ['--input-type=module', '-e', program, dir, JSON.stringify([point])]),
    ),
  )
  const registry = new CardRegistry(dir)
  assert.equal(registry.list().length, 1)
  assert.equal(registry.find(1)?.record.occurrences.length, 0)
  assert.equal(registry.reviewNotices('s', []).length, 1)
  assert.equal(registry.reviewNotices('s', []).length, 0)
  registry.close()
})

test('legacy delivery reuses a closed card whose matching review was an occurrence from another session', () => {
  const registry = registries.fresh()
  const first = { ...findingOf(), provenance: provenanceOf({ session: 'first' }) }
  const later = { ...findingOf({ review: 'later/F1' }), provenance: provenanceOf({ session: 'later' }) }
  registry.open(first)
  registry.open(later)
  registry.closeCard(1, 'wontfix', 'already decided')
  registry.publishReview('recovered', 'later', [
    { ...later, identity: 'full-identity', legacyPoint: JSON.stringify([later.content.review, later.content.message]) },
  ])
  assert.equal(registry.list({ states: ['closed', 'open'] }).length, 1)
  assert.equal(registry.find(1)?.record.occurrences.length, 1)
})
