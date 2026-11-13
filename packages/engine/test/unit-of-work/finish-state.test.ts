import assert from 'node:assert/strict'
import { test } from 'vitest'
import { AttributionWindow } from '../../src/unit-of-work/attribution/attribution-window.ts'
import { UnitOfWork } from '../../src/unit-of-work/unit/unit-of-work.ts'

const window = new AttributionWindow({
  at: '2026-01-01T00:00:00Z',
  tool: 'Write',
  untilStop: false,
  exact: true,
  before: {},
  head: null,
  attribution: 'all',
  agent: null,
  task: null,
})
const intent = { at: '2026-01-01T01:00:00Z', source: 'prompt', text: 'let us discuss this', answering: null } as const

test('discussion and uncharged changes preserve the reminder; only new attributed work re-arms it', () => {
  const first = UnitOfWork.fresh(1)
    .charge(window, {
      charged: new Map([['a.ts', { before: 'base', after: 'one' }]]),
      shown: [],
      headMoved: null,
    })
    .unit.withReminder()
  const discussed = first.withRequest(intent).withRequest({ ...intent, text: 'another question' })
  assert.equal(discussed.reminded, true)
  assert.equal(discussed.charge(window, { charged: new Map(), shown: ['owner.ts'], headMoved: null }).unit.reminded, true)
  assert.equal(
    discussed.charge(window, {
      charged: new Map([['a.ts', { before: 'base', after: 'one' }]]),
      shown: [],
      headMoved: null,
    }).unit.reminded,
    true,
    'a late window rediscovering the same content is not new work',
  )
  const edited = discussed.charge(window, {
    charged: new Map([['a.ts', { before: 'one', after: 'two' }]]),
    shown: [],
    headMoved: null,
  }).unit
  assert.equal(edited.reminded, false)
  assert.equal(edited.withReminder().withRequest(intent).reminded, true)
})

test('ordinary requests retain the refusal cap and notice, while #check resets both', () => {
  const failed = UnitOfWork.fresh(1).withFailedRound()
  const notified = new UnitOfWork({ ...failed.record, check: { ...failed.record.check, capNotified: true } })
  const discussion = notified.withRequest(intent)
  assert.equal(discussion.rounds, 1)
  assert.equal(discussion.record.check.capNotified, true)
  const retry = discussion.withRequest({ ...intent, text: '#check please' })
  assert.equal(retry.rounds, 0)
  assert.equal(retry.record.check.capNotified, false)
  assert.equal(retry.record.check.retry, true)
})
