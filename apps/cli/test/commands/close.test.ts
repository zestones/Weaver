import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, test } from 'vitest'
import { cardOf, finding, flag, write } from '../fixtures/cards.ts'
import { makeProject, SETTINGS, weaver, writeConfig } from '../fixtures/project.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-close-'))
// Stands for the command of a project that files an issue: it keeps the words it was given, and fails on demand.
const filer = join(scratch, 'file-issue.mjs')
const received = join(scratch, 'received.json')
let top: string
let counter = 0

writeFileSync(
  filer,
  [
    `import { writeFileSync } from 'node:fs'`,
    `const [file, ...words] = process.argv.slice(2)`,
    `writeFileSync(file, JSON.stringify(words))`,
    `if (words.includes('--fail')) { console.error('no network'); process.exit(1) }`,
    `if (!words.includes('--quiet')) console.log('https://issues.example/42')`,
  ].join('\n'),
)

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

// Card 1 is a flag the writer wrote up and labelled, card 2 a finding of a review, which has no label.
beforeEach(() => {
  counter += 1
  top = makeProject(join(scratch, `project-${String(counter)}`))
  rmSync(received, { force: true })
  flag(top)
  write(top, 1)
  finding(top)
})

const declareFiler = (...words: string[]): void => {
  writeConfig(top, { settings: SETTINGS, issues: { command: ['node', filer, received, ...words] } })
}
const receivedWords = (): string[] => JSON.parse(readFileSync(received, 'utf8')) as string[]

test('close takes a card off the list, as fixed or as wontfix, and keeps the reason', async () => {
  assert.deepEqual(await weaver(top, ['close', '1', 'fixed']), { status: 0, lines: ['Card #1 closed as fixed.'] })
  assert.deepEqual(await weaver(top, ['close', '2', 'wontfix', 'compared', 'on', 'purpose']), {
    status: 0,
    lines: ['Card #2 closed as wontfix.'],
  })

  const { state, closing } = cardOf(top, 2).record

  assert.equal(state, 'closed')
  assert.deepEqual([closing?.as, closing?.reason, closing?.issue], ['wontfix', 'compared on purpose', null])
  assert.deepEqual([cardOf(top, 1).record.closing?.as, cardOf(top, 1).record.closing?.reason], ['fixed', null])
  assert.deepEqual((await weaver(top, ['cards'])).lines, ['Nothing waits for you.'])
})

test('every error of the registry is shown as it says, and the card stays as it was', async () => {
  assert.deepEqual(await weaver(top, ['close', '1', 'wontfix']), {
    status: 1,
    lines: ['weaver: closing card #1 as wontfix needs a reason'],
  })
  assert.equal(cardOf(top, 1).state, 'open')
  assert.deepEqual(await weaver(top, ['close', '9', 'fixed']), { status: 1, lines: ['weaver: no card has the number 9'] })

  await weaver(top, ['close', '1', 'fixed'])
  declareFiler('{title}')

  assert.deepEqual(await weaver(top, ['close', '1', 'issue']), { status: 1, lines: ['weaver: card #1 is already closed as fixed'] })
  assert.equal(existsSync(received), false, 'a card that cannot be closed is not filed')
  assert.equal(cardOf(top, 1).record.closing?.as, 'fixed')
})

test('close says how it is written when a word is missing or unknown', async () => {
  const usage = ['weaver close <number> fixed|wontfix|issue [reason]']

  assert.deepEqual(await weaver(top, ['close']), { status: 2, lines: usage })
  assert.deepEqual(await weaver(top, ['close', '1']), { status: 2, lines: usage })
  assert.deepEqual(await weaver(top, ['close', '1', 'later']), { status: 2, lines: usage })
  assert.deepEqual(await weaver(top, ['close', 'F1', 'fixed']), { status: 2, lines: usage })
})

test('closing as an issue runs the command of the project with the title, the card and its labels, and keeps what it printed', async () => {
  declareFiler('--title', '{title}', '--label', '{labels}', '--body={body}')

  assert.deepEqual(await weaver(top, ['close', '1', 'issue', 'for', 'the', 'next', 'release']), {
    status: 0,
    lines: ['Card #1 closed as issue: https://issues.example/42'],
  })

  const [, title, , labels, body = ''] = receivedWords()
  const { closing, state } = cardOf(top, 1).record

  assert.deepEqual([title, labels], ['Nothing refreshes the token', 'type:bug,area:auth'])
  assert.match(body, /^--body=# Nothing refreshes the token\n\n- Card: #1\n[^]*\n- State: open\n[^]*## Flag\n\n```text\nSeen: /)
  assert.equal(state, 'closed')
  assert.deepEqual([closing?.as, closing?.reason, closing?.issue], ['issue', 'for the next release', 'https://issues.example/42'])
  assert.match(
    (await weaver(top, ['cards', '1'])).lines.join('\n'),
    /\n## Closing\n\nClosed as issue on [^\n]*: for the next release\n\nIssue: https:\/\/issues\.example\/42$/,
  )
})

test('a card without labels is filed without the option that names them', async () => {
  declareFiler('--title', '{title}', '{labels}', '--label', '{labels}', '--labels={labels}', '{body}', '--quiet')

  assert.deepEqual(await weaver(top, ['close', '2', 'issue']), { status: 0, lines: ['Card #2 closed as issue.'] })

  const [flag, title, body, quiet, ...others] = receivedWords()

  assert.deepEqual([flag, title, quiet, others], ['--title', 'The response is cast to User without being parsed.', '--quiet', []])
  assert.match(body ?? '', /^# The response is cast to User without being parsed\.\n\n- Card: #2\n/)
  assert.deepEqual([cardOf(top, 2).record.closing?.as, cardOf(top, 2).record.closing?.issue], ['issue', null])
})

test('when the command fails, the card stays open and the owner reads why', async () => {
  declareFiler('{title}', '--fail')

  assert.deepEqual(await weaver(top, ['close', '1', 'issue']), {
    status: 1,
    lines: ['weaver: the issue was not filed, and card #1 stays open: no network'],
  })
  assert.deepEqual([cardOf(top, 1).state, cardOf(top, 1).record.closing], ['open', null])

  writeConfig(top, { settings: SETTINGS, issues: { command: ['/nowhere/file-issue', '{title}'] } })

  assert.match(
    (await weaver(top, ['close', '1', 'issue'])).lines[0] ?? '',
    /^weaver: the issue was not filed, and card #1 stays open: .*ENOENT/,
  )
  assert.equal(cardOf(top, 1).state, 'open')
})

test('without a declared command, closing as an issue only records it, and says so', async () => {
  assert.deepEqual(await weaver(top, ['close', '1', 'issue', 'filed', 'by', 'hand']), {
    status: 0,
    lines: ['Card #1 closed as issue, which is only recorded: .weaver/project/issues.json names no command that files one.'],
  })
  assert.deepEqual(
    [cardOf(top, 1).record.closing?.as, cardOf(top, 1).record.closing?.reason, cardOf(top, 1).record.closing?.issue],
    ['issue', 'filed by hand', null],
  )
})

test('a declaration that cannot be read files nothing and closes nothing', async () => {
  writeConfig(top, { settings: { ...SETTINGS, chekcs: {} }, issues: { command: ['node', filer, received] } })

  const { status, lines } = await weaver(top, ['close', '1', 'issue'])

  assert.equal(status, 1)
  assert.match(lines[0] ?? '', /^weaver: \.weaver is not a valid project declaration: settings\.json: chekcs is not a known field$/)
  assert.equal(cardOf(top, 1).state, 'open')
})
