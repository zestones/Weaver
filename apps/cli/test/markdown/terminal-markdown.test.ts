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
const DOCUMENT = [
  '# The token is never refreshed',
  '',
  'Seen on 2026-10-12.',
  '',
  '',
  '## Observation',
  '',
  '`getToken` returns the cached value and nothing under `src/` calls `refresh()`:',
  '',
  '```ts',
  '    export function getToken(): string {',
  '      return cached // never renewed',
  '    }',
  '```',
  '',
  '### What was not checked',
  '',
  '- Fix: none yet',
  '- State: open',
].join('\n')

test('a document is drawn as a page: its title underlined, its parts under a rule, its prose folded, its code set apart', () => {
  assert.deepEqual(drawn(DOCUMENT), [
    'The token is never refreshed',
    '────────────────────────────',
    '',
    'Seen on 2026-10-12.',
    '',
    'Observation ────────────────────────────────────────────────',
    '',
    'getToken returns the cached value and nothing under src/',
    'calls refresh():',
    '',
    '  │ export function getToken(): string {',
    '  │   return cached // never renewed',
    '  │ }',
    '',
    'What was not checked',
    '',
    '  • Fix: none yet',
    '  • State: open',
  ])
  assert.deepEqual(
    drawn('## A heading that is longer than the page is wide', 30),
    ['A heading that is longer than', 'the page is wide'],
    'a heading that fills its line has no rule',
  )
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
  assert.deepEqual(drawn('- before the code:\n\n  ```\n  a = 1\n  ```\n- after'), ['  • before the code:', '      │ a = 1', '  • after'])
})

test('a quote, a rule and a table are drawn, and what the page does not know is left as it is', () => {
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
  ])
  assert.deepEqual(drawn('wide\n\n\n\n### Next', 500), ['wide', '', 'Next'], 'one blank line sets two blocks apart')
  assert.equal(Math.max(...drawn('word '.repeat(80), 500).map((line) => line.length)), 99, 'a page is never wider than prose reads well')
})

test('a quote that names its kind is a callout: the kind is its title', () => {
  assert.deepEqual(drawn('> [!NOTE]\n> The lines date from an earlier commit,\n> not from this work.', 40), [
    '  │ Note',
    '  │ The lines date from an earlier',
    '  │ commit, not from this work.',
  ])
  assert.deepEqual(new TerminalMarkdown(coloured, 40).lines('> [!WARNING] Not run.'), [
    '  \u001B[90m│\u001B[39m \u001B[33mWarning\u001B[39m',
    '  \u001B[90m│\u001B[39m Not run.',
  ])
  assert.deepEqual(drawn('> [!SOMETHING] else'), ['  │ [!SOMETHING] else'])
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
  assert.equal(
    inline
      .typed('`refresh()` is in __init__.py, see *args and [x](y)')
      .map((atom) => atom.text)
      .join(' '),
    '\u001B[36mrefresh()\u001B[39m is in __init__.py, see *args and [x](y)',
    'what was typed outside of Markdown keeps its marks, but for the backticks',
  )
})

test('code is coloured by the grammar of its language, each kind of thing in a colour of the terminal', () => {
  const colours = new CodeColours(coloured)
  const lines = (text: string, language: string): string[] => colours.rows(text, language, Infinity).map(([row = '']) => row)

  assert.deepEqual(lines('class Mapper(Base):\n    def attach(self, n=3):\n        return f"a {n} # b", len(x), None  # why', 'python'), [
    '\u001B[35mclass\u001B[39m \u001B[36mMapper\u001B[39m(\u001B[36mBase\u001B[39m):',
    '    \u001B[35mdef\u001B[39m \u001B[34mattach\u001B[39m(self, n=\u001B[33m3\u001B[39m):',
    '        \u001B[35mreturn\u001B[39m \u001B[32mf"a \u001B[39m{n}\u001B[32m # b"\u001B[39m, \u001B[36mlen\u001B[39m(x), \u001B[33mNone\u001B[39m  \u001B[90m# why\u001B[39m',
  ])
  assert.deepEqual(lines('const a = `x<y` // y', 'ts'), [
    '\u001B[35mconst\u001B[39m a = \u001B[32m`x<y`\u001B[39m \u001B[90m// y\u001B[39m',
  ])
  assert.deepEqual(lines('{"a": [1, "s"]}', 'json'), ['{\u001B[34m"a"\u001B[39m: [\u001B[33m1\u001B[39m, \u001B[32m"s"\u001B[39m]}'])
  assert.deepEqual(lines('+added\n-removed\n kept', 'diff'), ['\u001B[32m+added\u001B[39m', '\u001B[31m-removed\u001B[39m', ' kept'])
  assert.deepEqual(
    lines('/* a comment\n   on two lines */', 'js'),
    ['\u001B[90m/* a comment\u001B[39m', '\u001B[90m   on two lines */\u001B[39m'],
    'a style never runs over the end of a line',
  )
  assert.deepEqual(lines('return "x" # y', 'a-language-nobody-knows'), ['return "x" # y'])
  assert.deepEqual(lines('a < b && c', ''), ['a < b && c'], 'code that names no language is left as it is')
})

test('a line of code longer than the page goes on on the next row, broken after a space, each row closing its styles', () => {
  const colours = new CodeColours(coloured)

  assert.deepEqual(colours.rows('x = "a long string"  # and why\ny = 1', 'python', 12), [
    ['x = \u001B[32m"a long \u001B[39m', '\u001B[32mstring"\u001B[39m  \u001B[90m# \u001B[39m', '\u001B[90mand why\u001B[39m'],
    ['y = \u001B[33m1\u001B[39m'],
  ])
  assert.deepEqual(
    new CodeColours(plain).rows('abcdefgh\n\nij', '', 3),
    [['abc', 'def', 'gh'], [''], ['ij']],
    'a word is cut only where no space is near',
  )
})

test('the screen draws a page for a person at a terminal, and gives a program what is written', async () => {
  const said = async (paint: Paint, width: number | null): Promise<string[]> => {
    const lines: string[] = []
    const screen = new Screen({ paint, failPaint: plain, width, say: (line) => void lines.push(line), fail: () => undefined })

    await screen.page('# Title', (given, columns) => Promise.resolve([given.bold('Title'), `${String(columns)} columns`]))

    return lines
  }

  assert.deepEqual(await said(plain, 80), ['# Title'])
  assert.deepEqual(await said(coloured, null), ['# Title'], 'a pipe is not a terminal, whatever was asked')
  assert.deepEqual(
    await said(coloured, 80),
    ['', '  \u001B[1mTitle\u001B[22m', '  76 columns', ''],
    'a page is set apart: a margin on each side, a blank line above and under',
  )
})
