import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlagText } from '@weaver/memory'
import { afterAll, beforeEach, test } from 'vitest'
import { FlagBriefing } from '../../src/flagging/briefing/flag-briefing.ts'
import { Session } from '../../src/unit-of-work/session/session.ts'
import { cardsOf, FLAG_BODY, flagCommand, withRegistry } from '../fixtures/cards.ts'
import { git, makeRepo, SAMPLE_REPO } from '../fixtures/repo.ts'
import {
  A_FILE,
  agentWrites,
  bashCall,
  declaration,
  eventsOf,
  FAILING,
  finishWith,
  PASSING,
  prompt,
  refusalOf,
  stateOf,
  stubChecks,
  stubWriters,
  unitFiles,
} from '../fixtures/session.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-flags-'))
const RECORDED = (card: number): string =>
  `[weaver] Flag ${String(card)} recorded for the owner. This command is answered here and never runs: that is expected. Go on with your task.`
const WRITER = { runtime: 'codex', model: 'gpt-5.5', effort: 'low', timeoutSeconds: 300 }
const LABELS = { type: { bug: 'Something that does not do what it should.' }, area: { auth: 'Signing in and out.' } }
let session: Session
let counter = 0

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1
  session = new Session(makeRepo(join(scratch, `repo-${String(counter)}`), SAMPLE_REPO), 's', 'claude')
})

const flag = (places: readonly string[] = [A_FILE], body?: string) => bashCall(flagCommand(places, body))
const flagsOf = () => eventsOf(session, 'flag').map(({ unit, card, known }) => ({ unit, card, known }))

test('a flag is answered in place of its command: the call is refused with the acknowledgement, and the session journals it', () => {
  prompt(session, 'refresh the token before it expires')

  const reason = refusalOf(session, flag([`${A_FILE}:1`]))
  const [card] = cardsOf(session.repo)

  assert.equal(reason, RECORDED(1))
  assert.deepEqual(
    { ...card?.record.provenance, at: null },
    {
      author: 'claude',
      role: 'author',
      session: 's',
      subagent: null,
      unit: 1,
      requests: ['refresh the token before it expires'],
      commit: git(session.repo.top, ['rev-parse', 'HEAD']),
      at: null,
    },
  )
  assert.deepEqual([card?.places, card?.record.flag?.text], [[{ file: A_FILE, line: 1 }], FLAG_BODY])
  assert.deepEqual(flagsOf(), [{ unit: 1, card: 1, known: false }])
  assert.deepEqual(stateOf(session)?.pending, {}, 'a command that never runs writes nothing to watch')
})

test('the runtime says who calls: a subagent flags in the session of its parent, under its own id', () => {
  prompt(session, 'look for the callers')

  refusalOf(session, { ...flag(), agent_id: 'a406db5d5f6bb15fe', agent_type: 'general-purpose' })

  const [card] = cardsOf(session.repo)

  assert.deepEqual([card?.record.provenance.session, card?.record.provenance.subagent], ['s', 'a406db5d5f6bb15fe'])
  assert.deepEqual(card?.record.provenance.requests, ['look for the callers'])
})

test('a call the hook sees twice records one flag, and a flag that cannot be used records none', () => {
  const call = { ...flag(), tool_use_id: 'the-same-call' }

  assert.equal(refusalOf(session, call), RECORDED(1))
  assert.equal(refusalOf(session, call), '[weaver] This flag is already recorded as 1. Go on with your task.')
  assert.deepEqual(flagsOf(), [
    { unit: 1, card: 1, known: false },
    { unit: 1, card: 1, known: true },
  ])

  const missing = refusalOf(session, flag([A_FILE], 'Seen: nothing calls it.\nFound: reading.\nChecked: grep.\nDid: left as it is.\n'))
  const bare = refusalOf(session, bashCall(`weaver flag ${A_FILE}`))

  assert.equal(
    missing,
    `[weaver] The flag was not recorded: \`Expected:\` is missing: say what you expected instead, or that it is unknown.\n\n${FlagText.FORMAT}`,
  )
  assert.equal(
    bare,
    `[weaver] The flag was not recorded: The flag has no body: the five fields are read from a heredoc after the command.\n\n${FlagText.FORMAT}`,
  )
  assert.equal(cardsOf(session.repo).length, 1)
  assert.equal(flagsOf().length, 2)
})

test('a call that holds several flags records each of them, once however many times the hook sees the call', () => {
  const second = FLAG_BODY.replace('refresh()', 'renew()')
  const call = { ...bashCall(`${flagCommand([`${A_FILE}:1`])}\necho "exit $?"\n${flagCommand([], second)}`), tool_use_id: 'two-flags' }
  const both = [RECORDED(1), RECORDED(2)].join('\n')

  assert.equal(refusalOf(session, call), both)
  assert.deepEqual(
    cardsOf(session.repo).map((card) => [card.number, card.places.length, card.record.flag?.text]),
    [
      [1, 1, FLAG_BODY],
      [2, 0, second],
    ],
  )
  assert.equal(
    refusalOf(session, call),
    [
      '[weaver] This flag is already recorded as 1. Go on with your task.',
      '[weaver] This flag is already recorded as 2. Go on with your task.',
    ].join('\n'),
  )
  assert.equal(cardsOf(session.repo).length, 2)
  assert.deepEqual(
    flagsOf().map(({ card, known }) => [card, known]),
    [
      [1, false],
      [2, false],
      [1, true],
      [2, true],
    ],
  )
})

test('a flag never reaches the guards, which judge every other command of Weaver', () => {
  const project = declaration({ guards: { own: { statement: 'Weaver is not run here.', runs: ['weaver'] } } })

  assert.equal(refusalOf(session, flag(['.weaver/settings.json']), project), RECORDED(1))
  assert.equal(
    refusalOf(session, bashCall('weaver cards'), project),
    '[weaver own] Running `weaver` is refused. Weaver is not run here. Only the owner lifts the guards, for this session: `weaver maintenance on s`.',
  )
  assert.deepEqual(
    eventsOf(session, 'refuse').map(({ guard, what }) => [guard, what]),
    [['own', 'Running `weaver`']],
  )
  assert.deepEqual(flagsOf(), [{ unit: 1, card: 1, known: false }])
})

test('the lines a flag names are kept with where they come from: the unit of work that flags them, or what was there before', () => {
  prompt(session, 'add a second constant')
  agentWrites(session, { [A_FILE]: 'export const a = 1\nexport const added = 2\n' })
  refusalOf(session, bashCall(`cd src && ${flagCommand(['a.ts:2', 'a.ts:1', '../package.json:1'])}`))

  const [card] = cardsOf(session.repo)
  const [written, old, untouched] = card?.record.flag?.context ?? []

  assert.deepEqual(card?.places, [
    { file: A_FILE, line: 2 },
    { file: A_FILE, line: 1 },
    { file: 'package.json', line: 1 },
  ])
  assert.deepEqual([written?.origin, written?.lineText, written?.wroteBy], ['unit', 'export const added = 2', []])
  assert.equal(written?.excerpt, '1  export const a = 1\n2  export const added = 2')
  assert.deepEqual([old?.origin, old?.wroteBy.map((commit) => commit.subject)], ['before', ['initial']])
  assert.deepEqual([untouched?.origin, untouched?.lastCommits.map((commit) => commit.subject)], ['before', ['initial']])
})

test('when Weaver cannot record a flag, the call is refused all the same and the agent is told to say it to the owner', () => {
  mkdirSync(join(session.repo.stateDir, 'registry.sqlite'), { recursive: true })

  assert.match(
    refusalOf(session, flag()) ?? '',
    /^\[weaver\] The flag was not recorded, because Weaver failed: the registry at \S+registry\.sqlite could not be used: .*\. This command is answered here and never runs\. Say what you wanted to flag in your final message, for the owner, and go on with your task\.$/,
  )
  assert.deepEqual(flagsOf(), [])
})

test('every request tells the agent about the command, beside what the owner is told of a mistyped directive', () => {
  const briefing = { hookEventName: 'UserPromptSubmit', additionalContext: new FlagBriefing().text }
  const reviewed = declaration({ review: { runtime: 'codex' } })
  const mistyped = prompt(session, 'rename it #critcal', reviewed)

  assert.deepEqual(prompt(session, 'rename it'), { hookSpecificOutput: briefing })
  assert.deepEqual(mistyped, {
    hookSpecificOutput: briefing,
    systemMessage: '[weaver] #critcal is not a directive: did you mean #critical?',
  })
  assert.deepEqual(prompt(session, 'look for the callers of getToken', reviewed, { agent_id: 'a406db5d5f6bb15fe' }), {
    hookSpecificOutput: briefing,
  })
  assert.deepEqual(prompt(session, '<task-notification>done</task-notification>'), { hookSpecificOutput: briefing })
  assert.deepEqual(
    stateOf(session)?.unit.intents.map((intent) => intent.text),
    ['rename it #critcal', 'rename it'],
    'only the owner’s words are requests',
  )
})

test('what an agent is told says when to flag, how, that the refusal is expected and not to fix the thing in its task', () => {
  const { text } = new FlagBriefing()

  assert.match(text, /something that the owner will have to decide on later and that your task does not settle/)
  assert.match(text, /Do not flag a matter of taste, what a linter catches, nor what the owner only has to check in your own change\./)
  assert.match(text, /even when you also speak of it in your final message/)
  assert.ok(text.includes(`\n\n${FlagText.FORMAT}\n\n`))
  assert.match(text, /Weaver takes the call before it runs and answers in its place/)
  assert.match(text, /That message is the answer, not a failure, so do not run the command again\./)
  assert.match(text, /make it in a task that only reads too/)
  assert.match(text, /When the owner names a card, read it with `weaver cards <number>`; `weaver cards` lists the ones that wait\.$/)
  assert.match(
    text,
    /Do not fix what you flag in the task, unless the task cannot go on without it: flag it then with `Did: fixed in the task`\.\n/,
  )
})

test('the owner is told which flags were made in a turn, once, whatever the turn ended with', async () => {
  prompt(session, 'read the token code')
  refusalOf(session, flag([A_FILE]))
  refusalOf(session, flag(['package.json'], FLAG_BODY.replace('refresh()', 'renew()')))

  assert.deepEqual(await finishWith(session, stubChecks([PASSING]), declaration(), 'Which one do you want first?'), {
    systemMessage: '[weaver] Flagged in this turn: #1, #2 (weaver cards).',
  })
  assert.deepEqual(await finishWith(session, stubChecks([PASSING])), {}, 'a flag is named once')

  agentWrites(session, { [A_FILE]: 'export const a = 2\n' })
  refusalOf(session, flag([A_FILE], FLAG_BODY.replace('refresh()', 'rotate()')))

  const refused = await finishWith(session, stubChecks([FAILING]))

  assert.equal(refused.decision, 'block')
  assert.equal(refused.systemMessage, '[weaver] Flagged in this turn: #3 (weaver cards).')

  refusalOf(session, { ...flag([A_FILE], FLAG_BODY.replace('refresh()', 'revoke()')), agent_id: 'a406db5d5f6bb15fe' })

  assert.match(
    (await finishWith(session, stubChecks([PASSING]))).systemMessage ?? '',
    /^\[weaver\] Flagged in this turn: #4 \(weaver cards\)\. \[weaver\] 1 check passed on 1 changed file\. Report: \S+$/,
  )
  assert.deepEqual(unitFiles(session), [])
})

test('at the end of a turn the writer of the project is started on the flags that wait, with what the project declares', async () => {
  const writers = stubWriters()
  const project = declaration({ writer: WRITER, labels: LABELS })
  const finish = (declared = project) => finishWith(session, stubChecks([PASSING]), declared, undefined, undefined, writers)

  await finish()
  assert.deepEqual(writers.jobs, [], 'no flag waits')

  refusalOf(session, flag())
  await finish(declaration({ labels: LABELS }))
  assert.deepEqual(writers.jobs, [], 'a project that declares no writer keeps its flags raw')

  await finish()
  assert.deepEqual(writers.jobs, [
    {
      top: session.repo.top,
      stateDir: session.repo.stateDir,
      settings: { ...WRITER, skill: null, sections: ['Observation', 'Context', 'Trace', 'Uncertainties'] },
      labels: LABELS,
      environment: { WEAVER_REVIEWER: '1' },
    },
  ])

  withRegistry(session.repo, (registry) => {
    registry.writingFailed(1, 'no answer after 300 s')
    registry.writingFailed(1, 'no answer after 300 s')
  })
  await finish()
  assert.equal(writers.jobs.length, 1, 'a flag the writer failed on twice waits for it no more')
})

test('a writer that names its skill is given it, with the sections the skill lists', async () => {
  const writers = stubWriters()
  const project = declaration({ writer: { runtime: 'claude', sections: ['Seen', 'Why it matters'] } })

  refusalOf(session, flag())
  await finishWith(session, stubChecks([PASSING]), project, undefined, undefined, writers)

  assert.deepEqual(writers.jobs[0]?.settings, {
    runtime: 'claude',
    model: null,
    effort: null,
    timeoutSeconds: 600,
    skill: '.weaver/skills/wv-card.md',
    sections: ['Seen', 'Why it matters'],
  })
})
