import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import { Session } from '../../src/unit-of-work/session/session.ts'
import { cardsOf, FLAG_BODY, flagCommand, withRegistry } from '../fixtures/cards.ts'
import { makeRepo, SAMPLE_REPO, writeFiles } from '../fixtures/repo.ts'
import { A_FILE, agentRuns, B_FILE, bashCall, eventsOf, finishWith, PASSING, prompt, refusalOf, stubChecks } from '../fixtures/session.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-card-notes-'))
const CONFIRMED = "weaver note 1 confirmed <<'EOF'\nRan: grep over src/.\nRead: the client.\nShows: refresh() is never called.\nEOF"
let session: Session
let counter = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  session = new Session(makeRepo(join(scratch, `repo-${String(counter)}`), SAMPLE_REPO), 's', 'claude')
  refusalOf(session, bashCall(flagCommand([A_FILE])))
})

const told = (answer: ReturnType<typeof agentRuns>): string => {
  const output = answer.body?.hookSpecificOutput

  return output !== undefined && 'additionalContext' in output ? output.additionalContext : ''
}

const edits = (path: string, content: string): ReturnType<typeof agentRuns> =>
  agentRuns(session, `printf '%s' '${content}' > ${path}`, () => {
    writeFiles(session.repo.top, { [path]: content })
  })

const held = (): unknown[] => eventsOf(session, 'turn').map((turn) => turn.held)

test('a call that changes the file of a card that waits tells the agent of it once, and the end of the task asks for its note once', async () => {
  prompt(session, 'call refresh() before a request')

  const first = told(edits(A_FILE, 'export const a = 2\n'))

  assert.match(first, /^\[weaver\] This call changed files of cards that wait for the owner:\n- #1 .+ \(src\/a\.ts\)\n/)
  assert.match(first, /write it on the card before you finish, with `weaver note`/)
  assert.equal(told(edits(A_FILE, 'export const a = 3\n')), '', 'the agent knows of the card already')

  const checks = stubChecks([PASSING])
  const asked = await finishWith(session, checks)

  assert.equal(asked.decision, 'block')
  assert.match(asked.reason ?? '', /nothing was written on them during it:\n- #1 .+: your work changed src\/a\.ts\n/)
  assert.match(asked.reason ?? '', /weaver note <number> fixed <<'EOF'\nChanged:/)
  assert.equal(checks.calls.count, 0, 'the work is checked once the agent has written on its cards')

  const settled = await finishWith(session, checks)

  assert.equal(settled.decision, undefined, 'the end of the task asks once')
  assert.equal(checks.calls.count, 1)
  assert.deepEqual(held(), ['cards', null])
})

test('a card the agent read in its task is asked for too, and a note written on it asks for nothing more', async () => {
  prompt(session, 'look at card 1')
  refusalOf(session, bashCall('weaver cards 1'))
  edits(B_FILE, 'export const b = 2\n')

  assert.match((await finishWith(session, stubChecks([PASSING]))).reason ?? '', /- #1 .+: you read it\n/)
  assert.equal((await finishWith(session, stubChecks([PASSING]))).decision, undefined)

  prompt(session, 'look at card 1 again')
  refusalOf(session, bashCall('weaver cards 1'))
  edits(B_FILE, 'export const b = 3\n')
  refusalOf(session, bashCall(CONFIRMED))

  assert.equal((await finishWith(session, stubChecks([PASSING]))).decision, undefined)
  assert.deepEqual(held(), ['cards', null, null])
})

test('a card closed, or concluded fixed, is no longer the agent’s to write on', async () => {
  withRegistry(session.repo, (registry) => registry.closeCard(1, 'wontfix', 'not worth it'))
  refusalOf(session, bashCall(flagCommand([B_FILE], FLAG_BODY.replace('Did: left as it is.', 'Did: fixed in the task.'))))
  prompt(session, 'change a and b')

  assert.deepEqual(
    cardsOf(session.repo).map((card) => [card.state, card.conclusion?.as ?? null]),
    [
      ['closed', null],
      ['raw', 'fixed'],
    ],
  )

  assert.equal(told(edits(A_FILE, 'export const a = 2\n')), '')
  assert.equal(told(edits(B_FILE, 'export const b = 2\n')), '')
  assert.equal((await finishWith(session, stubChecks([PASSING]))).decision, undefined)
})

test('a note that concludes nothing is free text: the card is still asked for its report', async () => {
  prompt(session, 'look at card 1')
  refusalOf(session, bashCall('weaver cards 1'))
  edits(B_FILE, 'export const b = 2\n')
  refusalOf(session, bashCall('weaver note 1 "looked at it"'))

  assert.match((await finishWith(session, stubChecks([PASSING]))).reason ?? '', /- #1 .+: you read it\n/)
})

test('a card the final message names is answered for, and a card a subagent only read is its own to write on', async () => {
  prompt(session, 'change a')
  edits(A_FILE, 'export const a = 2\n')

  const checks = stubChecks([PASSING])

  assert.equal((await finishWith(session, checks, undefined, '## Request\n\nDone. Card #1 is left as it was.\n')).decision, undefined)
  assert.equal(checks.calls.count, 1)

  prompt(session, 'have a subagent look at card 1, then change b')
  refusalOf(session, { ...bashCall('weaver cards 1'), agent_id: 'a406db5d5f6bb15fe' })
  edits(B_FILE, 'export const b = 2\n')

  assert.equal((await finishWith(session, stubChecks([PASSING]))).decision, undefined)
  assert.deepEqual(held(), [null, null])
})
