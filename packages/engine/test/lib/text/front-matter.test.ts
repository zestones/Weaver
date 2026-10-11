import assert from 'node:assert/strict'
import { test } from 'vitest'
import { frontMatter } from '../../../src/lib/text/front-matter.ts'

test('the header of a markdown file gives its texts and its lists, written one item a line or between brackets', () => {
  const skill = [
    '---',
    'description: "How to end a task: the final message."',
    'headings:',
    '  - Ta demande',
    "  - 'À valider'",
    'order: [first, "second one"]',
    '---',
    '',
    '## Ta demande',
    '',
  ].join('\n')

  assert.deepEqual(frontMatter(skill), {
    description: 'How to end a task: the final message.',
    headings: ['Ta demande', 'À valider'],
    order: ['first', 'second one'],
  })
})

test('a file without a header, or whose header never closes, has none', () => {
  assert.deepEqual(frontMatter('## Ta demande\n\nheadings:\n  - no\n'), {})
  assert.deepEqual(frontMatter('---\nheadings:\n  - open\n'), {})
  assert.deepEqual(frontMatter(''), {})
})
