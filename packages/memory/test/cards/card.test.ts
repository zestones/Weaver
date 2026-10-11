import assert from 'node:assert/strict'
import { test } from 'vitest'
import { Card } from '../../src/cards/card.ts'
import { contextOf, FLAG_BODY, flagRecordOf, provenanceOf, recordOf, reviewOf, writtenOf } from '../fixtures/cards.ts'

const CLOSED = {
  as: 'wontfix',
  reason: 'The token lives an hour, and no request waits that long.',
  issue: null,
  at: '2026-10-12T08:00:00.000Z',
} as const
const written = new Card(
  recordOf({
    state: 'open',
    places: [
      { file: 'src/auth/token.ts', line: 42 },
      { file: 'src/auth/session.ts', line: null },
    ],
    flag: flagRecordOf(FLAG_BODY, [contextOf()]),
    written: writtenOf(),
  }),
)
const finding = new Card(
  recordOf({
    number: 7,
    origin: 'finding',
    state: 'open',
    places: [{ file: 'src/api/user.ts', line: 7 }],
    provenance: provenanceOf({ author: 'codex', role: 'reviewer' }),
    flag: null,
    review: reviewOf(),
  }),
)

test('a card answers for its record: its number, its state, its origin, its places, and whether it waits for the owner', () => {
  assert.deepEqual([written.number, written.state, written.origin, written.places.length], [12, 'open', 'flag', 2])
  assert.equal(written.record.flag?.text, FLAG_BODY)
  assert.deepEqual(
    (['raw', 'open', 'closed', 'merged'] as const).map((state) => new Card(recordOf({ state })).isWaiting),
    [true, true, false, false],
  )
})

test('the title is the one the writer gave; a card nobody wrote up is named after what it holds, on one clipped line', () => {
  const long = flagRecordOf(
    FLAG_BODY.replace('no call of refresh() exists under src/.', `the cache\n  is never emptied${' at all'.repeat(20)}`),
  )

  assert.equal(written.title, 'Nothing refreshes the token')
  assert.equal(new Card(recordOf()).title, 'no call of refresh() exists under src/.')
  assert.equal(finding.title, 'The response is cast to User without being parsed.')
  assert.match(new Card(recordOf({ flag: long })).title, /^the cache is never emptied at all at all .*…$/)
  assert.ok(new Card(recordOf({ flag: long })).title.length <= 80)
})

test('one line says the number, the state, the first place and the title, with how the card was closed when it was', () => {
  assert.equal(written.oneLine(), '#12 open  src/auth/token.ts:42 +1  Nothing refreshes the token')
  assert.equal(new Card(recordOf()).oneLine(), '#12 raw  src/auth/token.ts:42  no call of refresh() exists under src/.')
  assert.equal(new Card(recordOf({ places: [] })).oneLine(), '#12 raw  no call of refresh() exists under src/.')
  assert.equal(
    new Card(recordOf({ state: 'closed', closing: CLOSED, written: writtenOf() })).oneLine(),
    '#12 closed (wontfix)  src/auth/token.ts:42  Nothing refreshes the token',
  )
  assert.match(
    new Card(recordOf({ state: 'closed', closing: CLOSED, seenSinceClosing: true })).oneLine(),
    /^#12 closed \(wontfix, seen again\) {2}src/,
  )
  assert.match(new Card(recordOf({ state: 'merged', mergedInto: 7 })).oneLine(), /^#12 merged into #7 {2}src/)
})

test('the labels are given as family:value, and a card nobody wrote up has none', () => {
  assert.deepEqual(written.labels(), ['type:bug', 'area:auth'])
  assert.deepEqual(new Card(recordOf({ written: writtenOf({ labels: { area: ['auth', 'api'] } }) })).labels(), ['area:auth', 'area:api'])
  assert.deepEqual(new Card(recordOf()).labels(), [])
  assert.deepEqual(finding.labels(), [])
})

test('a written card as Markdown is its title, its header, its sections, its flag word for word, and the lines kept with it', () => {
  assert.equal(
    written.markdown(),
    [
      '# Nothing refreshes the token',
      '',
      '- Card: #12',
      '- Origin: flag',
      '- State: open',
      '- Labels: type:bug, area:auth',
      '- Places: `src/auth/token.ts:42`, `src/auth/session.ts`',
      '- Author: claude, as author',
      '- Session: `session-1`, unit 1',
      '- Asked by the owner: refresh the token before it expires',
      '- Date: 2026-10-11T10:00:00.000Z, at commit `3f9a2c1`',
      '- What the writer saw: what it read agrees with the flag. Read src/auth/token.ts: refresh() is defined and never called.',
      '',
      '## Observation',
      '',
      'No call of `refresh()` exists under `src/`.',
      '',
      '## Uncertainties',
      '',
      'The application was not run.',
      '',
      '## Flag',
      '',
      '```text',
      FLAG_BODY,
      '```',
      '',
      '`src/auth/token.ts:42` when it was flagged, lines that were there before the unit of work:',
      '',
      '```text',
      '41  export function getToken() {',
      '42    return cached',
      '43  }',
      '```',
    ].join('\n'),
  )
})

test('the header says who flagged and for which requests, and what is not known', () => {
  const owner = provenanceOf({ author: 'owner', role: 'owner', session: null, unit: null, requests: [], commit: null })
  const several = provenanceOf({ subagent: 'agent-7', requests: ['first\nrequest', `second ${'long '.repeat(100)}`] })
  const byOwner = new Card(recordOf({ origin: 'owner', places: [], provenance: owner })).markdown()
  const bySubagent = new Card(recordOf({ provenance: several })).markdown()

  assert.match(
    byOwner,
    /\n- Origin: owner\n- State: raw, not written up yet\n- Labels: none\n- Places: none\n- Author: the owner\n- Session: none\n/,
  )
  assert.match(byOwner, /\n- Asked by the owner: nothing recorded\n- Date: 2026-10-11T10:00:00\.000Z\n- What the writer saw: nothing yet\n/)
  assert.match(bySubagent, /\n- Author: claude, as author, subagent `agent-7`\n/)
  assert.match(bySubagent, /\n- Asked by the owner:\n {2}1\. first request\n {2}2\. second long [^\n]{280,290}…\n- Date/)
})

test('a raw card shows its flag and no section, and says when the writer failed on it', () => {
  const failed = new Card(recordOf({ writing: { attempts: 2, failure: 'no answer\nafter 600 s' } })).markdown()

  assert.match(failed, /\n- What the writer saw: nothing, after 2 failed attempts: no answer after 600 s\n\n## Flag\n\n```text\nSeen: /)
  assert.doesNotMatch(failed, /## Observation/)
})

test('a place whose file was not there says so, and one kept without its lines says nothing', () => {
  const gone = contextOf({ place: { file: 'src/gone.ts', line: 3 }, exists: false, excerpt: '', lineText: null })
  const whole = contextOf({ place: { file: 'src/whole.ts', line: null }, excerpt: '', lineText: null })
  const unit = contextOf({ origin: 'unit' })
  const text = new Card(recordOf({ flag: flagRecordOf(FLAG_BODY, [gone, whole, unit, contextOf({ origin: 'unknown' })]) })).markdown()

  assert.match(
    text,
    /```\n\n`src\/gone\.ts:3` was not there when it was flagged\.\n\n`src\/auth\/token\.ts:42` when it was flagged, lines that the unit of work wrote:\n/,
  )
  assert.match(text, /\n`src\/auth\/token\.ts:42` when it was flagged:\n\n```text\n41 /)
  assert.doesNotMatch(text, /whole\.ts` when/)
})

test('a flag that holds a fence is kept whole inside a longer one', () => {
  const body = FLAG_BODY.replace('grep over src/.', 'I ran:\n```sh\ngrep -r refresh src/\n```\nand')
  const text = new Card(recordOf({ flag: flagRecordOf(body) })).markdown()

  assert.ok(text.endsWith(`## Flag\n\n\`\`\`\`text\n${body}\n\`\`\`\``))
})

test('a card that comes from a review shows what the review said in place of sections and of a flag', () => {
  assert.equal(
    finding.markdown(),
    [
      '# The response is cast to User without being parsed.',
      '',
      '- Card: #7',
      '- Origin: finding',
      '- State: open',
      '- Labels: none',
      '- Places: `src/api/user.ts:7`',
      '- Author: codex, as reviewer',
      '- Session: `session-1`, unit 1',
      '- Asked by the owner: refresh the token before it expires',
      '- Date: 2026-10-11T10:00:00.000Z, at commit `3f9a2c1`',
      '',
      '## Finding',
      '',
      'The response is cast to User without being parsed.',
      '',
      '- Review: `3f9a2c1/F1`',
      '- Rule: N2: No cast of external data.',
      '- Why it waits for the owner: not fixed by the agent: the owner asked for it',
      '',
      '### The line as the reviewer read it',
      '',
      '```text',
      'const user = raw as User',
      '```',
      '',
      '### Suggestion',
      '',
      'Parse it with the schema of the user.',
    ].join('\n'),
  )
})

test('a suspicion is shown as one, with only what the reviewer gave', () => {
  const review = reviewOf({
    review: '3f9a2c1/S1',
    rule: null,
    statement: null,
    quote: null,
    suggestion: null,
    evidence: 'Ran the test twice.',
  })
  const text = new Card(recordOf({ origin: 'suspicion', state: 'open', flag: null, review })).markdown()

  assert.match(
    text,
    /\n## Suspicion\n\n[^\n]+\n\n- Review: `3f9a2c1\/S1`\n- Why it waits for the owner: [^\n]+\n\n### Evidence\n\nRan the test twice\.$/,
  )
  assert.doesNotMatch(text, /Rule:|Suggestion|reviewer read it|## Flag/)
})

test('a card ends with its occurrences, its ties and how it was closed', () => {
  const text = new Card(
    recordOf({
      state: 'closed',
      written: writtenOf(),
      closing: { ...CLOSED, as: 'issue', issue: 'https://example.com/issues/3' },
      seenSinceClosing: true,
      occurrences: [
        { card: 14, provenance: provenanceOf({ author: 'codex', at: '2026-10-13T09:00:00.000Z' }), note: 'the same missing\ncall' },
        { card: null, provenance: provenanceOf({ role: 'reviewer' }), note: '9c8b7a6/F2: still cast' },
      ],
      ties: [15, 16],
    }),
  ).markdown()

  assert.match(text, /\n- State: closed as issue\n/)
  assert.ok(
    text.endsWith(
      [
        '```',
        '',
        '## Occurrences',
        '',
        '- 2026-10-13T09:00:00.000Z, codex, as author, as card #14: the same missing call',
        '- 2026-10-11T10:00:00.000Z, claude, as reviewer: 9c8b7a6/F2: still cast',
        '',
        '## Ties',
        '',
        'May be the same thing as #15, #16.',
        '',
        '## Closing',
        '',
        'Closed as issue on 2026-10-12T08:00:00.000Z: The token lives an hour, and no request waits that long.',
        '',
        'Issue: https://example.com/issues/3',
        '',
        'Seen again since it was closed.',
      ].join('\n'),
    ),
  )
})

test('a card closed without a reason says how and when, and a merged one where it went', () => {
  const closed = new Card(
    recordOf({ state: 'closed', closing: { as: 'fixed', reason: null, issue: null, at: '2026-10-12T08:00:00.000Z' } }),
  )

  assert.ok(closed.markdown().endsWith('## Closing\n\nClosed as fixed on 2026-10-12T08:00:00.000Z.'))
  assert.match(new Card(recordOf({ state: 'merged', mergedInto: 7 })).markdown(), /\n- State: merged into #7\n/)
})

test('a place has changed when its flagged line is no longer in the file, or the file is gone', () => {
  const session = contextOf({ place: { file: 'src/auth/session.ts', line: 3 }, lineText: 'const ttl = 60' })
  const card = new Card(recordOf({ flag: flagRecordOf(FLAG_BODY, [contextOf(), session]) }))
  const files = (content: Readonly<Record<string, string>>) => (file: string) => content[file] ?? null

  assert.deepEqual(
    card.changedPlaces(files({ 'src/auth/token.ts': 'a\n  return cached\n', 'src/auth/session.ts': 'const ttl = 60\n' })),
    [],
  )
  assert.deepEqual(card.changedPlaces(files({ 'src/auth/token.ts': '  return fresh()\n', 'src/auth/session.ts': 'const ttl = 60\n' })), [
    { file: 'src/auth/token.ts', line: 42 },
  ])
  assert.deepEqual(card.changedPlaces(files({ 'src/auth/token.ts': '  return cached\n' })), [{ file: 'src/auth/session.ts', line: 3 }])
})

test('a flagged line that only moved, or was indented again, still reads as it did', () => {
  const card = new Card(recordOf({ flag: flagRecordOf(FLAG_BODY, [contextOf()]) }))

  assert.deepEqual(
    card.changedPlaces(() => `${'// a line added above\n'.repeat(30)}\t\treturn cached\r\n`),
    [],
  )
})

test('a place flagged without a line is never said to have changed, and a finding is followed by the line its reviewer quoted', () => {
  const whole = contextOf({ place: { file: 'src/whole.ts', line: null }, excerpt: '', lineText: null })

  assert.deepEqual(
    new Card(recordOf({ flag: flagRecordOf(FLAG_BODY, [whole]) })).changedPlaces(() => null),
    [],
  )
  assert.deepEqual(
    new Card(recordOf({ flag: flagRecordOf() })).changedPlaces(() => null),
    [],
  )
  assert.deepEqual(
    finding.changedPlaces(() => 'const user = raw as User\n'),
    [],
  )
  assert.deepEqual(
    finding.changedPlaces(() => 'const user = parse(raw)\n'),
    [{ file: 'src/api/user.ts', line: 7 }],
  )
  assert.deepEqual(
    new Card(recordOf({ flag: null, review: reviewOf({ quote: null }) })).changedPlaces(() => null),
    [],
  )
})
