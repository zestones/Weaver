import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import { declarationOf } from '../fixtures/declaration.ts'
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
  refusalOf(new Session(session.repo, 'earlier', 'claude'), bashCall(flagCommand([A_FILE], `${FLAG_BODY}Decision: none\n`)))
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

  assert.match(first, /^\[weaver\] Open cards on changed files:\n- #1 .+ \(src\/a\.ts\)\n/)
  assert.match(first, /document with `weaver note`/)
  assert.equal(told(edits(A_FILE, 'export const a = 3\n')), '', 'the agent knows of the card already')

  const checks = stubChecks([PASSING])
  const asked = await finishWith(session, checks)

  assert.equal(asked.decision, 'block')
  assert.match(asked.reason ?? '', /once for this unit\):\n- #1 .+: src\/a\.ts; claimed for resolution\./)
  assert.match(asked.reason ?? '', /weaver note <number> fixed <<'EOF'\nChanged:/)
  assert.equal(checks.calls.count, 0, 'the work is checked once the agent has written on its cards')

  const settled = await finishWith(session, checks)

  assert.equal(settled.decision, undefined, 'the end of the task asks once')
  assert.equal(checks.calls.count, 1)
  assert.deepEqual(held(), ['cards', null])
})

test('reading a card creates no note hold, even when another file changes', async () => {
  prompt(session, 'look at card 1')
  refusalOf(session, bashCall('weaver cards 1'))
  edits(B_FILE, 'export const b = 2\n')
  const checks = stubChecks([PASSING])
  assert.equal((await finishWith(session, checks)).decision, undefined)
  assert.equal(checks.calls.count, 1)
  assert.deepEqual(held(), [null])
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

test('a free note counts as written on a changed-file card', async () => {
  prompt(session, 'look at card 1')
  edits(A_FILE, 'export const a = 2\n')
  refusalOf(session, bashCall('weaver note 1 "looked at it"'))
  assert.equal((await finishWith(session, stubChecks([PASSING]))).decision, undefined)
})

test('an investigation note counts as written on a changed-file card', async () => {
  prompt(session, 'look at card 1')
  edits(A_FILE, 'export const a = 2\n')
  refusalOf(session, bashCall(CONFIRMED))
  assert.equal((await finishWith(session, stubChecks([PASSING]))).decision, undefined)
})

test('merely naming an actionable card does not bypass the resolution pass, and a deferral is kept', async () => {
  prompt(session, 'change a')
  edits(A_FILE, 'export const a = 2\n')
  const checks = stubChecks([PASSING])
  assert.equal((await finishWith(session, checks, undefined, '## Request\nDone. Card #1 is left as it was.')).decision, 'block')
  assert.equal(
    (await finishWith(session, checks, undefined, '## Request\n#1 is out of reach: requires a larger redesign.')).decision,
    undefined,
  )
  const card = cardsOf(session.repo)[0]
  assert.equal(card?.conclusion?.as, 'deferred')
  assert.equal(card?.decision.kind, 'none')
  assert.match(card?.record.notes.at(-1)?.text ?? '', /larger redesign/)
  assert.deepEqual(held(), ['cards', null])
})

test('a flag raised by this unit creates no note hold', async () => {
  prompt(session, 'change b')
  edits(B_FILE, 'export const b = 2\n')
  refusalOf(session, bashCall(flagCommand([B_FILE], `${FLAG_BODY}Decision: none\n`)))
  assert.equal((await finishWith(session, stubChecks([PASSING]))).decision, undefined)
})

test('there is only one card prompt per unit, even when later work touches another card', async () => {
  const earlier = new Session(session.repo, 'earlier-b', 'claude')
  refusalOf(earlier, bashCall(flagCommand([B_FILE], `${FLAG_BODY}Decision: none\n`)))
  prompt(session, 'change a')
  edits(A_FILE, 'export const a = 2\n')
  assert.equal((await finishWith(session, stubChecks([PASSING]))).decision, 'block')
  edits(B_FILE, 'export const b = 2\n')
  assert.equal((await finishWith(session, stubChecks([PASSING]))).decision, undefined)
  assert.deepEqual(held(), ['cards', null])
})

test('documented owner questions are not re-asked and unknown decisions are never claimed for resolution', async () => {
  refusalOf(session, bashCall('weaver note 1 needs-owner "Which expiry?"'))
  const other = new Session(session.repo, 'unknown', 'claude')
  refusalOf(other, bashCall(flagCommand([A_FILE], FLAG_BODY.replace('no call of refresh()', 'no call of clear()'))))
  session = new Session(session.repo, 'work', 'claude')
  prompt(session, 'change a')
  edits(A_FILE, 'export const a = 2\n')
  const asked = await finishWith(session, stubChecks([PASSING]))
  assert.doesNotMatch(asked.reason ?? '', /owner decision: Which expiry/)
  assert.match(asked.reason ?? '', /decision unknown/)
  assert.doesNotMatch(asked.reason ?? '', /; claimed for resolution/)
  assert.equal((await finishWith(session, stubChecks([PASSING]))).decision, undefined)
  assert.equal(cardsOf(session.repo).find((card) => card.number === 1)?.decision.kind, 'owner')
})

test('parallel agents do not receive the same resolution card', async () => {
  prompt(session, 'change a')
  edits(A_FILE, 'export const a = 2\n')
  assert.equal((await finishWith(session, stubChecks([PASSING]))).decision, 'block')
  session = new Session(session.repo, 'parallel', 'codex')
  prompt(session, 'also change a')
  edits(A_FILE, 'export const a = 3\n')
  assert.equal((await finishWith(session, stubChecks([PASSING]))).decision, undefined)
})

test('card mutations pass through the hook and retain the runtime author and session without a refusal', () => {
  prompt(session, 'Reorganize the cards')
  const command = 'weaver cards tie 1 2'
  const answer = refusalOf(session, bashCall(command))
  assert.equal(answer, null)
  withRegistry(session.repo, (registry) => {
    registry.claimCommand(['cards', 'tie', '1', '2'])
    assert.equal(registry.actor.author, 'claude')
    assert.equal(registry.actor.role, 'author')
    assert.equal(registry.actor.session, session.id)
    assert.deepEqual(registry.actor.requests, ['Reorganize the cards'])
  })
  assert.match(refusalOf(session, bashCall('weaver cards tie 1 2 && weaver close 1 fixed')) ?? '', /owner/)
})

test('agents can explicitly clear a decision or defer without owing an investigation report', () => {
  prompt(session, 'classify the card')
  assert.match(refusalOf(session, bashCall('weaver note 1 needs-owner "Which expiry?"')) ?? '', /Note written/)
  assert.match(refusalOf(session, bashCall('weaver note 1 no-decision "Existing policy already specifies one hour"')) ?? '', /Note written/)
  assert.match(refusalOf(session, bashCall('weaver note 1 deferred "Requires a broader redesign"')) ?? '', /Note written/)
  const card = cardsOf(session.repo)[0]
  assert.equal(card?.decision.kind, 'none')
  assert.equal(card?.record.lifecycle?.stage, 'deferred')
  assert.equal(card?.isInvestigated, false)
})

test('reading a card does not consume its later changed-file notice, and unrelated files stay silent', () => {
  prompt(session, 'read then change a')
  refusalOf(session, bashCall('weaver cards 1'))
  assert.equal(told(edits(B_FILE, 'export const b = 2\n')), '')
  assert.match(told(edits(A_FILE, 'export const a = 2\n')), /Open cards on changed files/)
  assert.equal(told(edits(A_FILE, 'export const a = 3\n')), '')
})

test('a completed fix releases its claim and leaves the card open for the owner', async () => {
  prompt(session, 'change a')
  edits(A_FILE, 'export const a = 2\n')
  assert.equal((await finishWith(session, stubChecks([PASSING]))).decision, 'block')
  refusalOf(session, bashCall(CONFIRMED))
  refusalOf(session, bashCall("weaver note 1 fixed <<'EOF'\nChanged: refreshed the token.\nVerified: tests pass.\nLeft: nothing.\nEOF"))
  assert.equal((await finishWith(session, stubChecks([PASSING]))).decision, undefined)
  const card = cardsOf(session.repo)[0]
  assert.equal(card?.state, 'raw')
  assert.equal(card?.conclusion?.as, 'fixed')
  assert.equal(
    card?.record.notes.some((note) => note.conclusion === 'deferred'),
    false,
  )
})

test('reverting all changed files still records a deferred resolution pass', async () => {
  prompt(session, 'change a')
  edits(A_FILE, 'export const a = 2\n')
  assert.equal((await finishWith(session, stubChecks([PASSING]))).decision, 'block')
  edits(A_FILE, 'export const a = 1\n')
  assert.equal(session.unit().isEmpty, true)
  assert.equal(
    (await finishWith(session, stubChecks([PASSING]), undefined, '## Request\n#1 deferred: needs a redesign.')).decision,
    undefined,
  )
  assert.equal(cardsOf(session.repo)[0]?.conclusion?.as, 'deferred')
})

for (const limit of [null, 1, 0]) {
  test(`the project card limit ${String(limit)} controls the once-per-unit resolution pass`, async () => {
    for (let n = 2; n <= 4; n++) {
      const earlier = new Session(session.repo, `earlier-${String(n)}`, 'claude')
      refusalOf(
        earlier,
        bashCall(flagCommand([A_FILE], `${FLAG_BODY.replace('no call of refresh()', `missing call ${String(n)}`)}Decision: none\n`)),
      )
    }
    const unrelated = new Session(session.repo, 'unrelated', 'claude')
    refusalOf(unrelated, bashCall(flagCommand([B_FILE], `${FLAG_BODY}Decision: none\n`)))
    prompt(session, 'change a')
    edits(A_FILE, 'export const a = 2\n')
    const project = declarationOf({ cards: { resolvePerTask: limit } })
    const checks = stubChecks([PASSING])
    const asked = await finishWith(session, checks, project)
    if (limit === 0) {
      assert.equal(asked.decision, undefined)
      assert.doesNotMatch(asked.reason ?? '', /Resolve|claimed for resolution/)
      assert.deepEqual(session.unit().cards.resolving ?? [], [])
      assert.deepEqual(held(), [null])
    } else {
      assert.equal(asked.decision, 'block')
      assert.equal((asked.reason?.match(/claimed for resolution/g) ?? []).length, limit ?? 4)
      assert.doesNotMatch(asked.reason ?? '', /#5 /)
      assert.doesNotMatch(asked.reason ?? '', /minutes|stop work|Spend at most/)
      if (limit === null) assert.doesNotMatch(asked.reason ?? '', /Handle at most/)
      else assert.match(asked.reason ?? '', /Handle at most 1 card in this pass/)
      assert.equal((await finishWith(session, checks, project)).decision, undefined)
      assert.deepEqual(held(), ['cards', null])
    }
    withRegistry(session.repo, (registry) => {
      assert.equal(registry.claimResolution([1, 2, 3, 4], 'later', null).length, 4, 'no claims remain after the next end of turn')
    })
  })
}

test('a deferral from another session suppresses the pass until its saved files change', async () => {
  prompt(session, 'change a')
  edits(A_FILE, 'export const a = 2\n')
  const other = new Session(session.repo, 'other-session', 'claude')
  refusalOf(other, bashCall('weaver note 1 deferred "Requires a broader redesign"'))
  assert.equal((await finishWith(session, stubChecks([PASSING]))).decision, undefined)
  const note = cardsOf(session.repo)[0]?.record.notes.at(-1)
  assert.ok(note?.fileBlobs?.[A_FILE])
})

test('a writer suggestion of none is claimed in the resolution pass', async () => {
  const other = new Session(session.repo, 'unknown-writer', 'claude')
  refusalOf(other, bashCall(flagCommand([A_FILE], FLAG_BODY.replace('no call of refresh()', 'missing clear()'))))
  withRegistry(session.repo, (registry) =>
    registry.written(2, {
      title: 'Missing clear',
      labels: {},
      sections: [],
      look: { verdict: 'agrees', note: 'Read it' },
      decision: { kind: 'none', question: null },
      writer: { runtime: 'claude', model: null, seconds: 1, costUsd: null },
      at: new Date().toISOString(),
    }),
  )
  prompt(session, 'change a')
  edits(A_FILE, 'export const a = 2\n')
  const asked = await finishWith(session, stubChecks([PASSING]))
  assert.match(asked.reason ?? '', /#2 .*claimed for resolution/)
})

test('a changed deferred card gets a fresh snapshot when the next pass defers it again', async () => {
  const earlier = new Session(session.repo, 'deferring', 'claude')
  refusalOf(earlier, bashCall('weaver note 1 deferred "Requires a redesign"'))
  prompt(session, 'change a')
  edits(A_FILE, 'export const a = 2\n')
  assert.equal((await finishWith(session, stubChecks([PASSING]))).decision, 'block')
  assert.equal((await finishWith(session, stubChecks([PASSING]))).decision, undefined)
  const card = cardsOf(session.repo)[0]
  assert.equal(card?.record.notes.length, 2)
  assert.equal(card?.record.notes.at(-1)?.provenance.session, session.id)
  assert.equal(card?.record.notes.at(-1)?.fileBlobs?.[A_FILE], session.repo.hashPaths([A_FILE]).get(A_FILE))
})

test('an explicit owner question is presented only once across sessions even without an answer', async () => {
  const earlier = new Session(session.repo, 'explicit-owner', 'claude')
  refusalOf(
    earlier,
    bashCall(flagCommand([A_FILE], `${FLAG_BODY.replace('no call of refresh()', 'missing expiry')}Decision: owner Which expiry?\n`)),
  )
  prompt(session, 'change a')
  edits(A_FILE, 'export const a = 2\n')
  assert.match((await finishWith(session, stubChecks([PASSING]))).reason ?? '', /owner decision: Which expiry/)
  await finishWith(session, stubChecks([PASSING]))
  session = new Session(session.repo, 'later-owner', 'claude')
  prompt(session, 'change a again')
  edits(A_FILE, 'export const a = 3\n')
  assert.doesNotMatch((await finishWith(session, stubChecks([PASSING]))).reason ?? '', /owner decision: Which expiry/)
})
