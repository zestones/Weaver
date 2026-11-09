import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { afterAll, beforeEach, test } from 'vitest'
import { CardDesk } from '../../src/cards/card-desk.ts'
import { IssueBody } from '../../src/cards/issue-body.ts'
import { Paint } from '../../src/output/paint.ts'
import { Project } from '../../src/project/project.ts'
import { UiModel } from '../../src/ui/model/ui-model.ts'
import { cardOf, finding, flag, inRegistry, note, write } from '../fixtures/cards.ts'
import { press } from '../fixtures/interface.ts'
import { makeProject, SETTINGS, weaver, writeConfig } from '../fixtures/project.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-lifecycle-'))
let top: string
let counter = 0
afterAll(() => rmSync(scratch, { recursive: true, force: true }))
beforeEach(() => {
  top = makeProject(join(scratch, String(++counter)))
  writeConfig(top, { settings: SETTINGS, labels: { type: { bug: 'A bug', debt: 'A debt' } } })
  flag(top)
  write(top, 1)
  finding(top)
})

test('agents run every card change, including revisions and restore, and each records its actor', async () => {
  const changes = [
    ['tie', '1', '2', 'Related evidence'],
    ['untie', '1', '2'],
    ['retitle', '1', 'New title'],
    ['label', '1', 'type:debt'],
    ['rewrite', '1'],
  ]
  for (const args of changes) {
    const result = await weaver(top, ['cards', ...args], { under: 'codex', input: '## Problem\nNew content' })
    assert.equal(result.status, 0, result.lines.join('\n'))
    assert.equal(cardOf(top, 1).record.history.at(-1)?.by?.author, 'codex')
    assert.equal(cardOf(top, 1).record.history.at(-1)?.by?.role, 'author')
  }
  inRegistry(top, (registry) => registry.merge(2, 1, 'Same'))
  assert.equal((await weaver(top, ['cards', 'separate', '2'], { under: 'claude' })).status, 0)
  assert.equal(cardOf(top, 2).record.history.at(-1)?.by?.author, 'claude')
  assert.equal(cardOf(top, 1).record.history.at(-1)?.by?.author, 'claude')
  assert.equal((await weaver(top, ['close', '1', 'fixed'], { under: 'claude' })).status, 1)
  assert.equal((await weaver(top, ['close', '1', 'fixed'])).status, 0)
  assert.equal((await weaver(top, ['cards', 'reopen', '1', 'It recurred'], { under: 'claude' })).status, 0)
  assert.equal(cardOf(top, 1).record.history.at(-1)?.by?.author, 'claude')
  const revisions = await weaver(top, ['cards', 'revisions', '1'], { under: 'codex' })
  assert.equal(revisions.status, 0)
  assert.match(revisions.lines.join('\n'), /New content/)
  assert.match(revisions.lines.join('\n'), /before/)
  const baseline = cardOf(top, 1).record.revisions?.[0]?.revision
  assert.ok(baseline)
  assert.equal((await weaver(top, ['cards', 'restore', '1', String(baseline), 'Restore evidence'], { under: 'codex' })).status, 0)
  assert.equal(cardOf(top, 1).title, 'Nothing refreshes the token')
})

test('the CLI distinguishes work, owner decisions and proposals, shows warning and accepts without a disposition', async () => {
  note(top, 1, { conclusion: 'fixed', text: 'Changed: refresh the token\nLeft: nothing' })
  note(top, 2, { conclusion: 'needs-owner', text: 'Which response format should we keep?' })
  flag(top, { text: 'Seen: new\nExpected: x\nFound: y\nChecked: z\nDid: left as it is.\nDecision: none' })
  const list = (await weaver(top, ['cards'])).lines.join('\n')
  assert.match(list, /actionable/)
  assert.match(list, /needs the owner/)
  assert.match(list, /proposed for closing/)
  for (const terminal of [undefined, 100]) {
    const shown = stripVTControlCharacters((await weaver(top, ['cards', '1'], terminal === undefined ? {} : { terminal })).lines.join('\n'))
    assert.match(shown, /Closing proposal/i)
    assert.match(shown, /verification not run/)
    assert.match(shown, /weaver close 1/)
  }
  const result = await weaver(top, ['close', '1'])
  assert.equal(result.status, 0, result.lines.join('\n'))
  assert.match(cardOf(top, 1).record.closing?.reason ?? '', /verification not run/)
  assert.ok(cardOf(top, 1).record.closing?.proposal)
})

test('CLI acceptance refuses a proposal changed after display, with the change named', async () => {
  note(top, 1, { conclusion: 'refuted', text: 'Ran: nothing\nRead: callers\nShows: another caller refreshes' })
  await weaver(top, ['cards', '1'])
  await weaver(top, ['cards', 'retitle', '1', 'Clarified title'], { under: 'codex' })
  const stale = await weaver(top, ['close', '1'])
  assert.equal(stale.status, 1)
  assert.match(stale.lines.join('\n'), /stale: corrected/)
  assert.equal(cardOf(top, 1).state, 'open')
  await weaver(top, ['cards', '1'])
  assert.equal((await weaver(top, ['close', '1'])).status, 0)
  assert.equal(cardOf(top, 1).record.closing?.as, 'invalid')
})

test('UI accepts proposals with one key, refuses stale snapshots, and enforces owner capability inside the desk', () => {
  note(top, 2, { conclusion: 'fixed', text: 'Legacy fix' })
  const project = Project.locate(top)
  const registry = project.registry()
  const desk = new CardDesk(project, registry)
  const model = new UiModel(desk, 'test', new Paint(false))
  assert.match(model.sheet.lines.join('\n'), /Closing proposal/i)
  note(top, 2, { conclusion: null, text: 'More evidence' })
  press(model, 'c')
  assert.match(model.said?.text ?? '', /stale: noted/)
  assert.match(model.selected?.record.proposal?.reason ?? '', /More evidence/)
  press(model, 'c')
  assert.equal(cardOf(top, 2).state, 'closed')
  assert.equal(model.box, null)
  registry.close()
  const agent = project.registry({ ...cardOf(top, 1).record.provenance, author: 'codex', role: 'author' })
  const agentDesk = new CardDesk(project, agent)
  assert.throws(() => agentDesk.close(1, 'fixed', null), /owner's/)
  assert.throws(() => agentDesk.close(1), /owner's/)
  const agentModel = new UiModel(agentDesk, 'test', new Paint(false))
  press(agentModel, 'c')
  assert.equal(agentModel.box, null)
  assert.equal(agentModel.canClose, false)
  assert.match(agentModel.said?.text ?? '', /owner's/)
  agentDesk.relabel(1, { type: ['debt'] })
  assert.equal(cardOf(top, 1).record.history.at(-1)?.by?.author, 'codex')
  agent.close()
})

test('issue documents remove embedded local references and expand ties, retaining explicit GitHub URLs', () => {
  inRegistry(top, (registry) => {
    registry.correct(1, {
      title: 'See card 2',
      sections: [{ name: 'Problem', text: 'See Card: #2 and #2. https://github.com/org/repo/issues/48' }],
    })
    registry.tie(1, 2, null)
  })
  note(top, 1, { text: 'Evidence from card 2, card #2 and #2; cards 1 and 2; weaver close 2; weaver cards tie 1 2.' })
  const text = inRegistry(top, (registry) => new IssueBody(registry).text(cardOf(top, 1), 'Follow card 2'))
  assert.doesNotMatch(text, /\b[12]\b/)
  assert.doesNotMatch(text, /\bcard\s*:?\s*#?\d+|#\d+|Session:|Asked by/i)
  assert.match(text, /The response is cast to User without being parsed/)
  assert.match(text, /https:\/\/github.com\/org\/repo\/issues\/48/)
  assert.match(text, /## Problem/)
  assert.match(text, /## Evidence/)
  assert.match(text, /## Proposed disposition/)
})

test('hook attribution is claimed once, preserving runtime session and subagent rather than stamping an owner', async () => {
  const actor = { ...cardOf(top, 1).record.provenance, subagent: 'worker-7', at: new Date().toISOString() }
  inRegistry(top, (registry) => registry.rememberCommand('call-1', ['cards', 'retitle', '1', 'Attributed'], actor))
  assert.equal((await weaver(top, ['cards', 'retitle', '1', 'Attributed'])).status, 0)
  assert.deepEqual(cardOf(top, 1).record.history.at(-1)?.by, actor)
  assert.equal((await weaver(top, ['cards', 'retitle', '1', 'Attributed'])).status, 0)
  assert.equal(cardOf(top, 1).record.history.at(-1)?.by?.role, 'owner')
})
