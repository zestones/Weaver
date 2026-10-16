import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Journal, Repository, type JournalEvent } from '@weaver/engine'
import { afterAll, test } from 'vitest'
import { Distribution } from '../../src/numbers/distribution.ts'
import { JournalNumbers } from '../../src/numbers/journal-numbers.ts'
import { Period } from '../../src/numbers/period.ts'
import { StatsPage } from '../../src/numbers/stats-page.ts'
import { drawn, makeProject } from '../fixtures/project.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-numbers-'))
const BASE = { v: 2, at: '2026-10-12T10:00:00.000Z', weaver: '0.3.0', session: 'one', agent: 'claude' } as const
const REVIEW = {
  kind: 'review',
  unit: 1,
  runtime: 'codex',
  model: 'a-model',
  reason: 'the runtime the project names',
  standing: 'sent-back',
  rules: 4,
  findings: 2,
  findingRules: ['N1', 'N2'],
  suspicions: 1,
  dropped: 0,
  experiments: 3,
  failure: null,
  seconds: 40,
  costUsd: 0.25,
} as const
const EVENTS: readonly JournalEvent[] = [
  { ...BASE, ...REVIEW },
  { ...BASE, ...REVIEW, standing: 'clean', findings: 0, findingRules: [], suspicions: 0, experiments: 0, seconds: 20, costUsd: null },
  {
    ...BASE,
    ...REVIEW,
    runtime: '',
    model: null,
    standing: 'skipped',
    rules: 0,
    findings: 0,
    findingRules: [],
    suspicions: 0,
    experiments: 0,
    seconds: 0,
    costUsd: null,
  },
  { ...BASE, kind: 'answer', unit: 1, finding: 1, rule: 'N1', status: 'fixed' },
  { ...BASE, kind: 'answer', unit: 1, finding: 2, rule: 'N2', status: 'not-fixed' },
  { ...BASE, kind: 'refuse', tool: 'Bash', guard: 'git-writes', what: 'Running `git commit`' },
  { ...BASE, kind: 'lift', tool: 'Bash', guard: 'git-writes', what: 'Running `git add`' },
  { ...BASE, kind: 'lift', tool: 'Write', guard: 'weaver:declaration', what: 'Writing .weaver/settings.json' },
  { ...BASE, kind: 'maintenance', on: true },
  { ...BASE, kind: 'maintenance', on: false },
  { ...BASE, kind: 'error', event: 'Stop', message: 'the registry is locked' },
  { ...BASE, session: 'two', agent: 'codex', kind: 'flag', unit: 1, card: 3, known: true },
  { ...BASE, session: null, agent: null, weaver: '0.2.0', kind: 'settle', unit: 2, files: 1, by: 'owner', notes: ['src/a.ts'] },
  { ...BASE, kind: 'settle', unit: 3, files: 2, by: 'check', notes: [] },
  { ...BASE, kind: 'settle', unit: 4, files: 0, by: 'check', notes: [] },
]

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

test('reviews are counted by who reviewed, with what they found and what their author answered, rule by rule', () => {
  const { reviews } = new JournalNumbers(EVENTS).figures

  assert.deepEqual(Object.keys(reviews.byReviewer), ['codex a-model', 'no reviewer'])
  assert.deepEqual(reviews.byReviewer['codex a-model'], {
    reviews: 2,
    byStanding: { 'sent-back': 1, clean: 1 },
    rules: 8,
    findings: 2,
    suspicions: 1,
    dropped: 0,
    experiments: 3,
    seconds: { count: 2, median: 20, ninthDecile: 40, largest: 40, total: 60 },
    costUsd: 0.25,
  })
  assert.equal(reviews.byReviewer['no reviewer']?.seconds.count, 0, 'a review that was skipped took no time')
  assert.deepEqual(reviews.answers, { fixed: 1, notFixed: 1, missing: 0 })
  assert.deepEqual(reviews.byRule, {
    N1: { findings: 1, fixed: 1, notFixed: 0, missing: 0 },
    N2: { findings: 1, fixed: 0, notFixed: 1, missing: 0 },
  })
})

test('guards, maintenance, errors and sessions are counted as they were kept', () => {
  const figures = new JournalNumbers(EVENTS).figures

  assert.deepEqual(figures.guards, { 'git-writes': { refused: 1, lifted: 1 }, 'weaver:declaration': { refused: 0, lifted: 1 } })
  assert.deepEqual(figures.maintenance, { turnedOn: 1, turnedOff: 1 })
  assert.deepEqual(figures.errors, { total: 1, byEvent: { Stop: 1 } })
  assert.deepEqual(
    figures.sessions,
    { total: 2, byAgent: { claude: 1, codex: 1 }, continued: 0 },
    'a line without a session is of no session',
  )
  assert.deepEqual(figures.flags, { made: 1, alreadyKnown: 1 })
  assert.deepEqual(figures.units, { settled: 3, byVerdict: 1, withNoFile: 1, byOwner: 1 })
  assert.deepEqual(figures.byWeaver, { '0.3.0': 14, '0.2.0': 1 })
  assert.deepEqual([figures.lines, figures.verdicts.total, figures.verdicts.ms.count], [EVENTS.length, 0, 0])
})

test('the page shows the reviews and their findings, and leaves out the tables that would be empty', () => {
  const page = new StatsPage({ since: null, journal: new JournalNumbers(EVENTS).figures, cards: null }, '/somewhere/events')
  const text = drawn((screen) => page.print(screen)).join('\n')

  assert.match(
    text,
    /\nReviews\n {2}reviewer {7}reviews {2}rules given {2}findings {2}suspicions {2}dropped {2}experiments {2}median {2}longest {3}cost {2}how they ended\n {2}codex a-model {8}2 {12}8 {9}2 {11}1 {8}0 {12}3 {2}20\.0 s {3}40\.0 s {2}\$0\.25 {2}sent-back 1, clean 1\n {2}no reviewer {10}1 {12}0 {9}0 {11}0 {8}0 {12}0 {7}- {8}- {2}\$0\.00 {2}skipped 1\n/,
  )
  assert.match(text, /\nAnswers to findings {7}fixed 1, not fixed 1, no answer 0\n/)
  assert.match(text, /\nFindings by rule\n {2}rule {2}findings {2}fixed {2}not fixed {2}no answer\n {2}N1 {11}1 {6}1 {10}0 {10}0\n/)
  assert.match(text, /\nGuards\n {2}guard {15}refused {2}let through in maintenance\n {2}git-writes {16}1 {27}1\n/)
  assert.match(text, /\nMaintenance {15}turned on 1, off 1\n/)
  assert.match(text, /\nVerdicts {18}0\nUnits of work settled {5}3: 1 by a verdict, 1 with no file to judge, 1 by the owner\n/)
  assert.match(text, /\nWeaver's own errors {7}1 \(Stop 1\)\nLines by Weaver {11}0\.3\.0 14, 0\.2\.0 1\n/)
  assert.match(text, /\nCards {21}0\n/)
  assert.doesNotMatch(text, /Checks at the end of a task|Warnings right after a call|Runs of the hook/)
})

test('a line an earlier Weaver wrote is read with nothing where it kept nothing yet', () => {
  const repository = Repository.locate(makeProject(join(scratch, 'earlier')))

  assert.ok(repository)

  const journal = new Journal(repository)
  const earlier = { v: 1, at: '2026-10-01T10:00:00.000Z', session: 'old', agent: 'claude' }
  // The first shape a review had: no standing, and neither its suspicions nor what it dropped.
  const review = { runtime: 'codex', findings: 1, held: true, setAside: 0, failure: null, seconds: 9, costUsd: null }
  const lines = [
    { ...earlier, kind: 'check', unit: 1, round: 1, passed: false, failed: ['lint'], toValidate: 0, files: 2, ms: 1500 },
    { ...earlier, kind: 'review', unit: 1, ...review },
  ]

  mkdirSync(journal.dir, { recursive: true })
  writeFileSync(join(journal.dir, 'old.jsonl'), lines.map((line) => `${JSON.stringify(line)}\n`).join(''))

  const figures = new JournalNumbers(journal.read()).figures

  assert.deepEqual([figures.verdicts.total, figures.verdicts.failed, figures.checks], [1, 1, {}])
  assert.deepEqual(figures.verdicts.ms, { count: 1, median: 1500, ninthDecile: 1500, largest: 1500, total: 1500 })
  assert.equal(figures.verdicts.files.count, 1)
  assert.equal(figures.verdicts.lines.count, 0, 'what was not measured then is not counted as nothing')
  assert.deepEqual(
    Object.entries(figures.reviews.byReviewer).map(([name, { reviews, findings, suspicions, dropped, byStanding }]) => [
      name,
      reviews,
      findings,
      suspicions,
      dropped,
      byStanding,
    ]),
    [['codex', 1, 1, 0, 0, { unknown: 1 }]],
  )
  assert.deepEqual(figures.byWeaver, { unknown: 2 })
})

test('a series of measures gives its median, the measure nine in ten stay under, its largest and its sum', () => {
  const series = new Distribution()

  assert.deepEqual(series.numbers, { count: 0, median: 0, ninthDecile: 0, largest: 0, total: 0 })

  for (const value of [9, 1, 5, 3, 7, 2, 8, 4, 6, 10]) series.add(value)

  assert.deepEqual(series.numbers, { count: 10, median: 5, ninthDecile: 9, largest: 10, total: 55 })
})

test('a period starts on a day or a number of days back, and holds what came since', () => {
  const now = new Date('2026-10-12T12:00:00')

  assert.equal(Period.whole().holds('1999-01-01T00:00:00.000Z'), true)
  assert.equal(Period.whole().holds(null), false, 'what has no date did not happen')
  assert.equal(Period.from('7d', now)?.since?.getTime(), new Date('2026-10-05T12:00:00').getTime())
  assert.equal(Period.from('2026-10-01', now)?.holds(new Date('2026-10-01T00:00:00').toISOString()), true)
  assert.equal(Period.from('2026-10-01', now)?.holds(new Date('2026-09-30T23:59:59').toISOString()), false)

  for (const word of ['', 'yesterday', '7', '2026-13-45', '10-01']) assert.equal(Period.from(word, now), null, word)
})

test('a session the runtime went on with under a new id is one session, and its continuation is counted apart', () => {
  const later = { ...BASE, at: '2026-10-12T11:00:00.000Z', session: 'two' } as const
  const figures = new JournalNumbers([
    { ...BASE, kind: 'turn', unit: 1, finished: true, held: 'cards' },
    { ...later, kind: 'continue', from: 'one' },
    { ...later, kind: 'turn', unit: 1, finished: true, held: null },
  ]).figures

  assert.deepEqual(figures.sessions, { total: 1, byAgent: { claude: 1 }, continued: 1 })
  assert.equal(figures.turns.heldByCards, 1)
})
