import assert from 'node:assert/strict'
import { test } from 'vitest'
import { OwnerRequest } from '../../src/unit-of-work/owner/owner-request.ts'
import { UnitOfWork } from '../../src/unit-of-work/unit/unit-of-work.ts'

const fromOwner = (text: string): boolean => new OwnerRequest(text).isFromOwner

test('text the agent runtime injects is not the owner speaking', () => {
  assert.equal(fromOwner('fix the drawer'), true)
  assert.equal(fromOwner('  <task-notification>done</task-notification>'), false)
  assert.equal(fromOwner('<system-reminder>x</system-reminder>'), false)
  assert.equal(fromOwner('   '), false)
})

test('a request keeps the reply it answers, and the same text twice is one request', () => {
  const once = UnitOfWork.fresh(1).withRequest(new OwnerRequest('yes, go').intent('Should I also rename it?'))
  const twice = once.withRequest(new OwnerRequest('yes, go').intent(null))

  assert.equal(twice.record.intents.length, 1)
  assert.equal(twice.record.intents[0]?.answering, 'Should I also rename it?')
})

test('a new request gives the checks their rounds again', () => {
  const refused = UnitOfWork.fresh(1).withFailedRound().withFailedRound()

  assert.equal(refused.rounds, 2)
  assert.equal(refused.withRequest(new OwnerRequest('try again').intent(null)).rounds, 0)
})
