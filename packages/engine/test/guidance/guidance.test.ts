import assert from 'node:assert/strict'
import { FlagText, NoteText } from '@weaver/memory'
import { test } from 'vitest'
import { RequestBriefing } from '../../src/guidance/briefing/request-briefing.ts'
import { WeaverGuide } from '../../src/guidance/guide/weaver-guide.ts'
import { OwnerCommandGuard } from '../../src/guards/kinds/owner-command-guard.ts'
import { declarationOf } from '../fixtures/declaration.ts'

const PROJECT = {
  finish: { headings: ['Request', 'To validate', 'Found along the way'] },
  checks: {
    format: { judge: ['true'], when: ['src/**/*.ts'], timeoutSeconds: 60, rules: { F1: 'The code is formatted.' } },
    tests: { judge: ['true'], after: 'format', timeoutSeconds: 1200, rules: { T1: 'The tests pass.' } },
  },
  guards: {
    'git-writes': { statement: 'Commits are the owner’s.', runs: ['git commit', 'git push'] },
    migrations: { statement: 'A migration is the owner’s decision.', writes: ['migrations/**'] },
  },
  review: { runtime: 'codex', rules: { N1: 'One level of abstraction per function.' } },
}
const BARE = declarationOf({})

test('every request names each command of Weaver at its moment, in a line, and leaves the how to the guide', () => {
  const { text } = new RequestBriefing(declarationOf(PROJECT))

  assert.deepEqual(text.split('\n').slice(1), [
    '- before you change a file: `weaver cards --file <path>` or `--search <words>`, what the owner already knows of it;',
    '- something your task does not settle: `weaver flag` it;',
    "- a check's verdict before the end: `weaver check <name>`, among format, tests;",
    '- a card your task settles or advances: `weaver note <number>`, what you looked into, then what you changed;',
    '- the end of a task that changed files: a final message with ## Request, ## To validate, ## Found along the way.',
    'How to do each, and what is the owner’s alone: `weaver guide`.',
  ])
  assert.ok(text.length < 1000, `the briefing is ${String(text.length)} characters long`)
  assert.doesNotMatch(new RequestBriefing(BARE).text, /weaver check|final message/, 'a project with no check and no sections')
})

test('the guide says how a task goes and each command with what the project declares', () => {
  const { text } = new WeaverGuide(declarationOf(PROJECT))

  assert.match(text, /^# Working under Weaver\n\n/)
  assert.match(text, /\n- `format`: runs when a file of `src\/\*\*\/\*\.ts` changed; it may take up to 1 min\.\n/)
  assert.match(text, /\n- `tests`: runs on any change, after `format`; it may take up to 20 min\.\n/)
  assert.ok(text.includes(`\`\`\`text\n${FlagText.FORMAT}\n\`\`\``))
  assert.ok(text.includes(`\`\`\`text\n${NoteText.FORMAT}\n\`\`\``))
  assert.match(text, /`weaver cards --file <path>`, one file at a time/)
  assert.match(text, /A fix is refused on a card where nothing yet says what was looked into/)
  assert.match(
    text,
    /these sections, in this order: `## Request`, `## To validate`, `## Found along the way`\. How to write them: `\.weaver\/skills\/wv-finish\.md`\./,
  )
  assert.match(text, /`F1 fixed: <what you changed>`, naming the file when the fix is in another file than the point/)
  assert.match(text, /\n- `git-writes` refuses running `git commit`, running `git push`: Commits are the owner’s\.\n/)
  assert.match(text, /\n- `migrations` refuses writing `migrations\/\*\*`: A migration is the owner’s decision\.$/)

  for (const command of OwnerCommandGuard.COMMANDS) assert.ok(text.includes(`\`weaver ${command}\``), `the guide names weaver ${command}`)
})

test('the guide of a project that declares little says so, and leaves out what does not apply', () => {
  const { text } = new WeaverGuide(BARE)

  assert.match(text, /This project declares no check\./)
  assert.match(text, /This project names no final sections: each end of a turn ends the task/)
  assert.doesNotMatch(text, /reviewer|F1|## The guards of this project/)
})

test('what the guide is for fits where both runtimes list their skills', () => {
  assert.ok(WeaverGuide.SUMMARY.length <= 1024, `${String(WeaverGuide.SUMMARY.length)} characters`)
})
