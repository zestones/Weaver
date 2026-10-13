import assert from 'node:assert/strict'
import { Card, type CardRecord } from '@weaver/memory'
import { test } from 'vitest'
import { CardPage } from '../../src/cards/card-page.ts'
import { LocalMoment } from '../../src/output/local-moment.ts'
import { Paint } from '../../src/output/paint.ts'

const AT = '2026-10-11T10:00:00.000Z'
// The moment as the clock of the machine that runs the tests has it.
const WHEN = new LocalMoment(AT).text
const PROVENANCE = {
  author: 'claude',
  role: 'author',
  session: 'session-1',
  subagent: null,
  unit: 2,
  requests: ['1. refresh the token before it expires\n2. and say what you changed in the session store', '#review'],
  commit: '0a4ee34bd1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6',
  at: AT,
} as const
const RAW: CardRecord = {
  number: 7,
  origin: 'flag',
  state: 'raw',
  places: [{ file: 'src/auth/token.py', line: 42 }],
  provenance: PROVENANCE,
  flag: {
    fields: {
      seen: 'no call of `refresh()` exists under src/, and __init__.py imports none.',
      expected: 'the token is refreshed before a request goes out.',
      found: 'I was looking for the callers of get_token for my task.',
      checked: 'grep over src/. I did not run the application.',
      did: 'left',
      didNote: 'it was so before this task.',
    },
    text: '',
    context: [
      {
        place: { file: 'src/auth/token.py', line: 42 },
        exists: true,
        excerpt: ['41      def get_token(self):', '42          return self._cached  # never renewed', '43  '].join('\n'),
        lineText: '        return self._cached  # never renewed',
        origin: 'before',
        wroteBy: [],
        lastCommits: [],
      },
      {
        place: { file: 'src/auth/gone.py', line: null },
        exists: false,
        excerpt: '',
        lineText: null,
        origin: 'unknown',
        wroteBy: [],
        lastCommits: [],
      },
    ],
  },
  review: null,
  written: null,
  closing: null,
  proposal: null,
  seenSinceClosing: false,
  occurrences: [],
  notes: [],
  ties: [],
  mergedInto: null,
  writing: { attempts: 0, failure: null },
  history: [],
}
const WRITTEN: CardRecord = {
  ...RAW,
  state: 'open',
  written: {
    title: 'Nothing refreshes the token',
    labels: { type: ['bug'], area: ['auth'] },
    sections: [
      { name: 'Observation', text: '`get_token` returns the cached value:\n\n```python\n    return self._cached\n```\n' },
      { name: 'Uncertainties', text: '- The application was not run.' },
    ],
    look: { verdict: 'agrees', note: 'Read `src/auth/token.py`: refresh() is never called.' },
    writer: { runtime: 'codex', model: 'gpt-5', seconds: 42, costUsd: null },
    at: AT,
  },
}
const page = (record: CardRecord, width = 72): string[] => new CardPage(new Card(record), new Paint(false), width).lines()

test('a card is drawn from what it holds: what it is, what was written of it, its flag, then where it comes from', () => {
  assert.deepEqual(page(WRITTEN), [
    'Nothing refreshes the token',
    `#7 · open · flagged by claude · ${WHEN} · type:bug, area:auth`,
    '',
    '  src/auth/token.py:42',
    '',
    'Observation ────────────────────────────────────────────────────────────',
    '',
    'get_token returns the cached value:',
    '',
    '  │ return self._cached',
    '',
    'Uncertainties ──────────────────────────────────────────────────────────',
    '',
    '  • The application was not run.',
    '',
    'Flag ───────────────────────────────────────────────────────────────────',
    '',
    '  Seen      no call of refresh() exists under src/, and __init__.py',
    '            imports none.',
    '  Expected  the token is refreshed before a request goes out.',
    '  Found     I was looking for the callers of get_token for my task.',
    '  Checked   grep over src/. I did not run the application.',
    '  Did       left as it is: it was so before this task.',
    '',
    '  src/auth/token.py:42 as it was when flagged, lines from before the',
    '  unit of work',
    '  41 │ def get_token(self):',
    '▸ 42 │     return self._cached  # never renewed',
    '  43 │',
    '',
    '  src/auth/gone.py was not there when it was flagged.',
    '',
    'Where it comes from ────────────────────────────────────────────────────',
    '',
    '  Session   session-1, unit 2',
    '  Commit    0a4ee34bd1c2',
    '  Writer    codex on gpt-5: agrees with the flag. Read',
    '            src/auth/token.py: refresh() is never called.',
    '  Asked     1. refresh the token before it expires…',
    '            #review',
    '',
    'Write on it with weaver note 7 [confirmed|refuted|unsure|fixed] <text>.',
    'Close it with weaver close 7 fixed|wontfix|issue|invalid [reason].',
  ])
})

test('a card nobody wrote up is named after what was seen, and says what the owner should know before reading on', () => {
  const failed = page({ ...RAW, writing: { attempts: 3, failure: 'the writer ran out of time' } }, 60)

  assert.deepEqual(failed.slice(0, 6), [
    'no call of refresh() exists under src/, and __init__.py',
    'imports none.',
    '#7 · raw, not written up yet · flagged by claude ·',
    WHEN,
    '! Writing it up failed, 3 times: the writer ran out of time',
    '',
  ])
  assert.equal(failed.includes('Flag ───────────────────────────────────────────────────────'), true)

  const disputed = page({ ...WRITTEN, written: WRITTEN.written && { ...WRITTEN.written, look: { verdict: 'contradicts', note: '' } } })

  assert.equal(disputed[2], '! What the writer read contradicts the flag: see Writer, below.')
  assert.equal(disputed.includes('  Writer    codex on gpt-5: contradicts the flag.'), true)
})

test('what a review left is drawn with its rule, the line its reviewer read and what it suggests', () => {
  const finding: CardRecord = {
    ...RAW,
    number: 2,
    origin: 'finding',
    state: 'open',
    places: [{ file: 'src/api/user.ts', line: 7 }],
    provenance: { ...PROVENANCE, author: 'codex', role: 'reviewer', subagent: 'a1', requests: ['parse the answer'], commit: null },
    flag: null,
    review: {
      review: '3f9a2c1/F1',
      rule: 'N2',
      statement: 'No cast of external data.',
      message: 'The response is cast to `User` without being parsed.',
      quote: '  const user = raw as User',
      suggestion: 'Parse it with the schema.',
      evidence: null,
      standing: 'not fixed by the agent: the owner asked for it',
    },
  }

  assert.deepEqual(page(finding), [
    'The response is cast to User without being parsed.',
    `#2 · open · found by codex, in a subagent · ${WHEN}`,
    '',
    '  src/api/user.ts:7',
    '',
    'Finding ────────────────────────────────────────────────────────────────',
    '',
    'The response is cast to User without being parsed.',
    '',
    '  Review    3f9a2c1/F1',
    '  Rule      N2: No cast of external data.',
    '  Waits     not fixed by the agent: the owner asked for it',
    '',
    'The line as the reviewer read it',
    '  │ const user = raw as User',
    '',
    'Suggestion',
    '',
    'Parse it with the schema.',
    '',
    'Where it comes from ────────────────────────────────────────────────────',
    '',
    '  Session   session-1, unit 2',
    '  Asked     parse the answer',
    '',
    'Write on it with weaver note 2 [confirmed|refuted|unsure|fixed] <text>.',
    'Close it with weaver close 2 fixed|wontfix|issue|invalid [reason].',
  ])
})

test('what was written on a card since is drawn after its flag: who, when and what they conclude, then what they say', () => {
  const checked = '2026-10-13T09:00:00.000Z'
  const said = '2026-10-14T09:00:00.000Z'
  const noted = page({
    ...WRITTEN,
    notes: [
      {
        provenance: { ...PROVENANCE, author: 'codex', subagent: 'a1', at: checked },
        conclusion: 'confirmed',
        text: 'Ran the test with a token of one second:\n\n```text\n401 Unauthorized\n```',
      },
      {
        provenance: { ...PROVENANCE, author: 'owner', role: 'owner', at: said },
        conclusion: null,
        text: 'To fix with the session store.\nNot before the next release.',
      },
    ],
  })

  assert.deepEqual(noted.slice(1, 3), [`#7 · open (confirmed) · flagged by claude · ${WHEN} ·`, 'type:bug, area:auth'])
  assert.deepEqual(noted.slice(noted.indexOf(`Notes ${'─'.repeat(66)}`), noted.indexOf(`Where it comes from ${'─'.repeat(52)}`)), [
    `Notes ${'─'.repeat(66)}`,
    '',
    `codex, in a subagent · ${new LocalMoment(checked).text} · confirmed`,
    '',
    'Ran the test with a token of one second:',
    '',
    '  │ 401 Unauthorized',
    '',
    `the owner · ${new LocalMoment(said).text}`,
    '',
    'To fix with the session store.',
    'Not before the next release.',
    '',
  ])
  assert.ok(noted.indexOf(`Flag ${'─'.repeat(67)}`) < noted.indexOf(`Notes ${'─'.repeat(66)}`))
  assert.equal(
    page({ ...RAW, flag: RAW.flag && { ...RAW.flag, fields: { ...RAW.flag.fields, did: 'fixed' } } })[1],
    '#7 · raw, not written up yet (fixed) · flagged by claude ·',
  )
})

test('a card that was closed says how, what came again and what it may be the same as, and offers no closing', () => {
  const closed = page({
    ...WRITTEN,
    state: 'closed',
    flag: null,
    written: WRITTEN.written && { ...WRITTEN.written, sections: [] },
    closing: { as: 'issue', reason: 'filed, to fix with the session store', issue: 'https://example.org/issues/12', at: AT },
    seenSinceClosing: true,
    occurrences: [{ card: 9, provenance: { ...PROVENANCE, role: 'owner' }, note: 'the same cache' }],
    ties: [3, 4],
  })

  assert.deepEqual(closed.slice(1, 3), [`#7 · closed (issue, seen again) · flagged by claude · ${WHEN} ·`, 'type:bug, area:auth'])
  assert.deepEqual(closed.slice(3, 23), [
    '! Seen again since it was closed.',
    '',
    '  src/auth/token.py:42',
    '',
    'Occurrences ────────────────────────────────────────────────────────────',
    '',
    `  • ${WHEN}, the owner, as card #9: the same cache`,
    '',
    'Ties ───────────────────────────────────────────────────────────────────',
    '',
    'May be the same thing as #3, #4.',
    '',
    'Closing ────────────────────────────────────────────────────────────────',
    '',
    '  As        issue',
    `  On        ${WHEN}`,
    '  Reason    filed, to fix with the session store',
    '  Issue     https://example.org/issues/12',
    '',
    'Where it comes from ────────────────────────────────────────────────────',
  ])
  assert.equal(closed.at(-1), '            #review', 'a card that no longer waits offers no closing')
})

test('at a terminal the page is coloured: how the card stands, its places, the names of its fields', () => {
  const lines = new CardPage(new Card(WRITTEN), new Paint(true), 72).lines()

  assert.equal(lines[0], '\u001B[1mNothing\u001B[22m \u001B[1mrefreshes\u001B[22m \u001B[1mthe\u001B[22m \u001B[1mtoken\u001B[22m')
  assert.equal(
    lines[1]?.startsWith('\u001B[1m#7\u001B[22m \u001B[90m·\u001B[39m \u001B[32mopen\u001B[39m \u001B[90m·\u001B[39m flagged by claude'),
    true,
  )
  assert.equal(lines[3], '  \u001B[36msrc/auth/token.py:42\u001B[39m')
  assert.equal(lines.includes('  \u001B[90mExpected\u001B[39m  the token is refreshed before a request goes out.'), true)
  assert.equal(
    lines.includes(
      '\u001B[33m▸\u001B[39m \u001B[1m42\u001B[22m \u001B[90m│\u001B[39m     \u001B[35mreturn\u001B[39m self._cached  \u001B[90m# never renewed\u001B[39m',
    ),
    true,
  )
})
