import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { Card } from '../../src/cards/card.ts'
import type { WriterJob, WriterSettings } from '../../src/writing/request/writer-job.ts'
import { WriterRequest } from '../../src/writing/request/writer-request.ts'
import { contextOf, FLAG_BODY, flagRecordOf, provenanceOf, recordOf, writtenOf } from '../fixtures/cards.ts'

const top = mkdtempSync(join(tmpdir(), 'weaver-memory-request-'))
const SKILL = '.weaver/skills/wv-card.md'
const SETTINGS: WriterSettings = {
  runtime: 'claude',
  model: null,
  effort: null,
  timeoutSeconds: 600,
  skill: SKILL,
  sections: ['Observation', 'Context', 'Trace', 'Uncertainties'],
}
const JOB: WriterJob = {
  top,
  stateDir: join(top, '.git/weaver'),
  settings: SETTINGS,
  labels: {
    type: { bug: 'Something does not\nwork as intended.', debt: 'Code that will cost later.' },
    area: { auth: 'Signing in and tokens.' },
  },
  environment: {},
}
const BARE: WriterJob = { ...JOB, settings: { ...SETTINGS, skill: null, sections: ['Seen', 'Open questions'] }, labels: {} }
const gone = contextOf({
  place: { file: 'src/gone.ts', line: null },
  exists: false,
  excerpt: '',
  lineText: null,
  wroteBy: [],
  lastCommits: [],
})
const flag = new Card(
  recordOf({
    places: [
      { file: 'src/auth/token.ts', line: 42 },
      { file: 'src/gone.ts', line: null },
    ],
    provenance: provenanceOf({ requests: ['refresh the token before it expires', 'and log it'] }),
    flag: flagRecordOf(FLAG_BODY, [contextOf(), gone]),
  }),
)
const other = new Card(
  recordOf({
    number: 13,
    origin: 'owner',
    places: [],
    provenance: provenanceOf({ author: 'owner', role: 'owner', session: null, unit: null, requests: [] }),
    flag: flagRecordOf(FLAG_BODY.replace('refresh()', 'renew()')),
  }),
)
const known = [
  new Card(recordOf({ number: 3, state: 'open', written: writtenOf() })),
  new Card(
    recordOf({
      number: 2,
      state: 'closed',
      written: writtenOf({ title: 'The token is cached for ever' }),
      closing: { as: 'wontfix', reason: 'The token lives\nan hour.', issue: null, at: '2026-10-01T08:00:00.000Z' },
    }),
  ),
]

mkdirSync(join(top, '.weaver/skills'), { recursive: true })
writeFileSync(join(top, SKILL), '# How cards are written here\n')

afterAll(() => {
  rmSync(top, { recursive: true, force: true })
})

test('the writer is told what it does: gather the context, look at the place, write the card, and nothing more', () => {
  const prompt = new WriterRequest(JOB, [flag], []).prompt()

  assert.match(prompt, /^You are writing cards for the owner of this repository\.\n/)
  assert.match(
    prompt,
    /\n- Gather the context: [^\n]+\n- Look at the place to see whether what the flag says is true\. A flag is a claim to look at, not a fact\.\n- Write the card\.\n/,
  )
  assert.match(prompt, /You only read: run nothing of the project, no test, no build, no script, and change no file\./)
  assert.match(prompt, /Do not investigate either: do not look for the cause, do not try to reproduce the problem, do not look for proof\./)
  assert.match(
    prompt,
    /A card gives enough context to be understood alone, months later, [^\n]+ It is neither an investigation nor a certainty/,
  )
})

test('each flag comes with its number, its places, what the owner asked, its text word for word, and what was kept with it', () => {
  const prompt = new WriterRequest(JOB, [flag, other], []).prompt()

  assert.match(
    prompt,
    /\n## The flags\n\n### Flag #12\n\nMade by claude, as author of the work it was made in\.\nPlaces: src\/auth\/token\.ts:42, src\/gone\.ts\n\nWhat the owner had asked for, in the work this flag was made in:\n\n1\. refresh the token before it expires\n2\. and log it\n\nThe flag, word for word:\n\n```text\nSeen: no call of refresh\(\) exists under src\/\.\n/,
  )
  assert.ok(
    prompt.includes(
      `\`\`\`text\n${FLAG_BODY}\n\`\`\`\n\nsrc/auth/token.ts:42, when the flag was made. These lines were there before the work the flag was made in.\n`,
    ),
  )
  assert.match(
    prompt,
    /\nCommits that wrote these lines:\n- a1b2c3d 2026-09-01 feat: cache the token\nLast commits of the file:\n- e4f5a6b 2026-10-02 refactor: move the session\n\n```text\n41 {2}export function getToken\(\) \{\n42 {4}return cached\n43 {2}\}\n```\n/,
  )
  assert.match(prompt, /\nsrc\/gone\.ts was not there when the flag was made\.\n/)
  assert.match(
    prompt,
    /\.\n\n### Flag #13\n\nMade by the owner\.\nPlaces: none, the flag names no file\.\n\nThe flag, word for word:\n\n```text\nSeen: no call of renew\(\)/,
  )
})

test('whether the flagged lines come from the work the flag was made in is said as Weaver computed it', () => {
  const made = (origin: 'unit' | 'unknown') =>
    new WriterRequest(JOB, [new Card(recordOf({ flag: flagRecordOf(FLAG_BODY, [contextOf({ origin })]) }))], []).prompt()

  assert.match(made('unit'), /when the flag was made\. These lines were written by the work the flag was made in\.\n/)
  assert.match(
    made('unknown'),
    /when the flag was made\. Whether these lines were there before the work the flag was made in is not known\.\n/,
  )
})

test('the skill to read first, the sections, the labels with what each means and the cards already known come once', () => {
  const prompt = new WriterRequest(JOB, [flag, other], known).prompt()
  const count = (part: string) => prompt.split(part).length - 1

  assert.match(prompt, /\n## How this project wants its cards written\n\nRead \.weaver\/skills\/wv-card\.md first, and follow it\.\n/)
  assert.match(
    prompt,
    /\n## The sections of a card\n\n[^\n]+\n\n- Observation: what was seen, and where\.\n- Context: what the agent was doing, and why it matters\.\n- Trace: how the agent came across it\.\n- Uncertainties: what was not verified\.\n/,
  )
  assert.match(
    prompt,
    /\n## The labels of this project\n\n[^\n]+from this list and from nowhere else[^\n]+\n\n- type:bug: Something does not work as intended\.\n- type:debt: Code that will cost later\.\n- area:auth: Signing in and tokens\.\n/,
  )
  assert.match(
    prompt,
    /\n## Cards already known on these files\n\n[^\n]+\n\n- #3 open {2}src\/auth\/token\.ts:42 {2}Nothing refreshes the token\n- #2 closed \(wontfix\) {2}src\/auth\/token\.ts:42 {2}The token is cached for ever \(the owner's reason: The token lives an hour\.\)\n/,
  )
  assert.deepEqual(
    [count('## The sections of a card'), count('## The labels of this project'), count('## Cards already known'), count('### Flag #')],
    [1, 1, 1, 2],
  )
  assert.ok(prompt.indexOf('## Cards already known') < prompt.indexOf('## The flags'))
  assert.ok(prompt.indexOf('## The flags') < prompt.indexOf('## Your answer'))
})

test('a project without a skill, labels or known cards is not told about them, and its own sections are only named', () => {
  const prompt = new WriterRequest(BARE, [flag], []).prompt()
  const unwritten = new WriterRequest({ ...JOB, settings: { ...SETTINGS, skill: '.weaver/skills/not-written.md' } }, [flag], []).prompt()

  assert.doesNotMatch(prompt, /How this project wants|The labels of this project|Cards already known/)
  assert.match(prompt, /\n- Seen\n- Open questions\n/)
  assert.match(prompt, /\n- `labels`: an empty list, since this project declares no label\.\n/)
  assert.doesNotMatch(unwritten, /How this project wants|not-written/, 'a skill that is named and not written yet')
})

test('the writer is told the answer to give for each flag: title, labels, sections, what it saw, and whether it is a known thing', () => {
  const prompt = new WriterRequest(JOB, [flag], known).prompt()
  const answer = prompt.slice(prompt.indexOf('## Your answer'))

  assert.match(answer, /One entry in `cards` for each flag above, and no other\./)
  assert.match(answer, /\n- `labels`: the labels that fit, each with its `family` and its `value`/)
  assert.match(answer, /\n- `sections`: every section named above/)
  assert.match(answer, /`verdict` is `agrees` when [^\n]+, `contradicts` when [^\n]+, and `cannot-tell` when /)
  assert.match(
    answer,
    /\n- `sameAs`: the number of a card already known, or of a flag earlier in this list, [^\n]+ `sure` is true only when you are sure of it/,
  )
})

test('the answer is held to a shape: the flags asked about, the families and the sections of the project, the three verdicts, every field required', () => {
  const schema = new WriterRequest(JOB, [flag, other], known).schema()
  const text = JSON.stringify(schema)
  const card = (schema.properties as { cards: { items: { required: string[]; additionalProperties: boolean } } }).cards.items

  assert.deepEqual([schema.type, schema.required, schema.additionalProperties], ['object', ['cards'], false])
  assert.deepEqual(card.required, ['flag', 'title', 'labels', 'sections', 'look', 'sameAs', 'sure', 'sameNote'])
  assert.equal(card.additionalProperties, false)
  assert.match(text, /"flag":\{"type":"integer","enum":\[12,13\]\}/)
  assert.match(text, /"family":\{"type":"string","enum":\["type","area"\]\}/)
  assert.match(text, /"name":\{"type":"string","enum":\["Observation","Context","Trace","Uncertainties"\]\}/)
  assert.match(text, /"verdict":\{"type":"string","enum":\["agrees","contradicts","cannot-tell"\]\}/)
  assert.match(text, /"sameAs":\{"type":\["integer","null"\]\},"sure":\{"type":"boolean"\},"sameNote":\{"type":\["string","null"\]\}/)
  assert.match(
    JSON.stringify(new WriterRequest(BARE, [flag], []).schema()),
    /"family":\{"type":"string"\},"value"/,
    'no list of families when none is declared',
  )
})
