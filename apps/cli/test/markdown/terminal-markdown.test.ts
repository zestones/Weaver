import assert from 'node:assert/strict'
import { Lexer } from 'marked'
import { test } from 'vitest'
import { CodeColours } from '../../src/markdown/code-colours.ts'
import { InlineMarkdown } from '../../src/markdown/inline-markdown.ts'
import { TerminalMarkdown } from '../../src/markdown/terminal-markdown.ts'
import { Paint } from '../../src/output/paint.ts'
import { Screen } from '../../src/output/screen.ts'

const plain = new Paint(false)
const coloured = new Paint(true)
// A document laid out for a terminal of this width, without its colours: what is asserted is where things are.
const drawn = (markdown: string, width = 60): string[] => new TerminalMarkdown(plain, width).lines(markdown)
const CARD = [
  '# The token is never refreshed',
  '',
  '- Card: #7',
  '- State: open',
  '- Places: `src/auth/token.ts:42`',
  '- Asked by the owner:',
  '  1. refresh the token before it expires, and say what you changed in the session store',
  '  2. #review',
  '- Date: 2026-10-12',
  '',
  '',
  '## Observation',
  '',
  '`getToken` returns the cached value and nothing under `src/` calls `refresh()`:',
  '',
  '```ts',
  'export function getToken(): string {',
  '  return cached // never renewed',
  '}',
  '```',
].join('\n')

test('a card is drawn as a page: its title underlined, its head lined up, its prose folded, its code set apart', () => {
  assert.deepEqual(drawn(CARD), [
    'The token is never refreshed',
    '────────────────────────────',
    '',
    'Card                #7',
    'State               open',
    'Places              src/auth/token.ts:42',
    'Asked by the owner',
    '  1. refresh the token before it expires, and say what you',
    '     changed in the session store',
    '  2. #review',
    'Date                2026-10-12',
    '',
    'Observation',
    '',
    'getToken returns the cached value and nothing under src/',
    'calls refresh():',
    '',
    '  │ export function getToken(): string {',
    '  │   return cached // never renewed',
    '  │ }',
  ])
})

test('a list keeps its marks and its levels, and the lines of an item stay under its first word', () => {
  const list = [
    '- a first point that is long enough to be folded onto a second line of the page',
    '  which goes on here',
    '  - under it',
    '* another',
    '',
    '9. nine',
    '10. ten',
  ].join('\n')

  assert.deepEqual(drawn(list, 40), [
    '  • a first point that is long enough to',
    '    be folded onto a second line of the',
    '    page which goes on here',
    '    • under it',
    '  • another',
    '',
    '  9. nine',
    '  10. ten',
  ])
  assert.deepEqual(
    drawn('- Fix: done\n- not a name, only a sentence'),
    ['  • Fix: done', '  • not a name, only a sentence'],
    'names are lined up only when every item has one',
  )
  assert.deepEqual(drawn('- before the code:\n\n  ```\n  a = 1\n  ```\n- after'), ['  • before the code:', '      │ a = 1', '  • after'])
})

test('a quote, a rule and a table are drawn, what the page does not know is left as it is, and code is never folded', () => {
  const page = [
    '> said by the owner,',
    '> on two lines',
    '',
    '---',
    '',
    '| check | time |',
    '|---|---|',
    '| `lint` | 79 s |',
    '',
    '<details>kept</details>',
    '',
    '~~~',
    'a line of code that is longer than the page is wide',
    '~~~',
  ].join('\n')

  assert.deepEqual(drawn(page, 30), [
    '  │ said by the owner, on two',
    '  │ lines',
    '',
    '──────────────────────────────',
    '',
    '  check  time',
    '  lint   79 s',
    '',
    '<details>kept</details>',
    '',
    '  │ a line of code that is longer than the page is wide',
  ])
  assert.deepEqual(drawn('wide\n\n\n\n## Next', 500), ['wide', '', 'Next'], 'one blank line sets two blocks apart')
  assert.equal(Math.max(...drawn('word '.repeat(80), 500).map((line) => line.length)), 99, 'a page is never wider than prose reads well')
})

test('what Markdown marks inside a line is drawn word by word, and a name with an underscore stays whole', () => {
  const inline = new InlineMarkdown(coloured)
  const text = (markdown: string): string =>
    inline
      .atoms(Lexer.lexInline(markdown))
      .map((atom) => atom.text)
      .join(' ')

  assert.equal(
    text('run `git rm --cached x`.'),
    'run \u001B[36mgit\u001B[39m \u001B[36mrm\u001B[39m \u001B[36m--cached\u001B[39m \u001B[36mx\u001B[39m.',
  )
  assert.equal(
    text('a **strong point** and _one_ more'),
    'a \u001B[1mstrong\u001B[22m \u001B[1mpoint\u001B[22m and \u001B[3mone\u001B[23m more',
  )
  assert.equal(
    text('**a `strong` name**'),
    '\u001B[1ma\u001B[22m \u001B[1m\u001B[36mstrong\u001B[39m\u001B[22m \u001B[1mname\u001B[22m',
    'a mark inside another keeps both',
  )
  assert.equal(text('app.after_request, a_b_c and a < b & c'), 'app.after_request, a_b_c and a < b & c')
  assert.equal(text('see [the guide](https://example.org/g)'), 'see the guide \u001B[90m(https://example.org/g)\u001B[39m')
  assert.deepEqual(
    inline.atoms(Lexer.lexInline('`code`, then')).map((atom) => atom.width),
    [5, 4],
    'what touches a word is part of it, and its width is the one it reads',
  )
})

test('code is coloured by the grammar of its language: comments step back, strings and keywords stand out', () => {
  const code = new CodeColours(coloured)

  assert.deepEqual(code.lines('def f(x):\n    return "a # b"  # why', 'python'), [
    '\u001B[1mdef\u001B[22m f(x):',
    '    \u001B[1mreturn\u001B[22m \u001B[32m"a # b"\u001B[39m  \u001B[90m# why\u001B[39m',
  ])
  assert.deepEqual(code.lines('const a = `x<y` // y', 'ts'), [
    '\u001B[1mconst\u001B[22m a = \u001B[32m`x<y`\u001B[39m \u001B[90m// y\u001B[39m',
  ])
  assert.deepEqual(code.lines('+added\n-removed\n kept', 'diff'), ['\u001B[32m+added\u001B[39m', '\u001B[31m-removed\u001B[39m', ' kept'])
  assert.deepEqual(
    code.lines('/* a comment\n   on two lines */', 'js'),
    ['\u001B[90m/* a comment\u001B[39m', '\u001B[90m   on two lines */\u001B[39m'],
    'a style never runs over the end of a line',
  )
  assert.deepEqual(code.lines('return "x" # y', 'a-language-nobody-knows'), ['return "x" # y'])
  assert.deepEqual(code.lines('a < b && c', ''), ['a < b && c'], 'code that names no language is left as it is')
})

test('the screen draws a document for a person at a terminal, and gives it as it is written to a program', async () => {
  const said = async (paint: Paint, width: number | null): Promise<string[]> => {
    const lines: string[] = []
    const screen = new Screen({ paint, failPaint: plain, width, say: (line) => void lines.push(line), fail: () => undefined })

    await screen.markdown('# Title\n\n- Card: #1\n- State: open')

    return lines
  }

  assert.deepEqual(await said(plain, 80), ['# Title\n\n- Card: #1\n- State: open'])
  assert.deepEqual(await said(coloured, null), ['# Title\n\n- Card: #1\n- State: open'], 'a pipe is not a terminal, whatever was asked')
  assert.deepEqual(await said(coloured, 80), [
    '\u001B[1mTitle\u001B[22m',
    '\u001B[90m─────\u001B[39m',
    '',
    '\u001B[90mCard \u001B[39m  #1',
    '\u001B[90mState\u001B[39m  open',
  ])
})
