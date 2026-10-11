import assert from 'node:assert/strict'
import { test } from 'vitest'
import { FlagText } from '../../src/flags/flag-text.ts'
import { FLAG_BODY } from '../fixtures/cards.ts'

const body = (lines: Readonly<Record<string, string>>): string =>
  Object.entries({ Seen: 'a', Expected: 'b', Found: 'c', Checked: 'd', Did: 'left', ...lines })
    .filter(([, value]) => value !== '(none)')
    .map(([keyword, value]) => `${keyword}: ${value}`)
    .join('\n')

test('a flag with its five fields has no problem, and each field holds what the agent wrote', () => {
  const flag = new FlagText(FLAG_BODY)

  assert.deepEqual(flag.problems(), [])
  assert.deepEqual(flag.fields(), {
    seen: 'no call of refresh() exists under src/.',
    expected: 'the token is refreshed before a request goes out.',
    found: 'I was looking for the callers of getToken for my task.',
    checked: 'grep over src/. I did not run the application.',
    did: 'left',
    didNote: null,
  })
})

test('a field runs until the next keyword and may span lines, blank ones included', () => {
  const flag = new FlagText('Seen: the first line\n  the second, indented\n\nand a third\nExpected: b\nFound: c\nChecked: d\nDid: left\n')

  assert.equal(flag.fields()?.seen, 'the first line\n  the second, indented\n\nand a third')
  assert.equal(flag.fields()?.expected, 'b')
})

test('the keywords are read in any letter case, and a body with Windows line ends is read the same', () => {
  const flag = new FlagText('SEEN: a\r\nexpected: b\r\nFound: c\r\ncHeCkEd: d\r\ndid: LEFT AS IT IS\r\n')

  assert.deepEqual(flag.problems(), [])
  assert.deepEqual(flag.fields(), { seen: 'a', expected: 'b', found: 'c', checked: 'd', did: 'left', didNote: null })
})

test('a keyword counts at the start of a line only: elsewhere it is part of the field', () => {
  const flag = new FlagText(body({ Seen: 'the log says Found: nothing\n  Expected: indented, so still what was seen' }))

  assert.deepEqual(flag.problems(), [])
  assert.equal(flag.fields()?.seen, 'the log says Found: nothing\n  Expected: indented, so still what was seen')
})

test('what comes before the first keyword is not a field, and keeps nothing from being recorded', () => {
  const flag = new FlagText(`A word before.\n${FLAG_BODY}`)

  assert.deepEqual(flag.problems(), [])
  assert.equal(flag.fields()?.seen, 'no call of refresh() exists under src/.')
})

test('a field may say that it is unknown, and a field of one letter is a field: nothing is judged by its length', () => {
  const flag = new FlagText(body({ Expected: 'unknown', Checked: 'x' }))

  assert.deepEqual(flag.problems(), [])
  assert.deepEqual([flag.fields()?.expected, flag.fields()?.checked], ['unknown', 'x'])
})

test('each field left out is a problem that names it and says what to write', () => {
  assert.deepEqual(new FlagText(body({ Expected: '(none)', Did: '(none)' })).problems(), [
    '`Expected:` is missing: say what you expected instead, or that it is unknown.',
    '`Did:` is missing: start it with `left as it is`, `worked around` or `fixed in the task`.',
  ])
  assert.deepEqual(
    new FlagText('The token is never refreshed.').problems().map((problem) => problem.split(' is missing')[0]),
    ['`Seen:`', '`Expected:`', '`Found:`', '`Checked:`', '`Did:`'],
  )
})

test('a field that says nothing is a problem', () => {
  assert.deepEqual(new FlagText('Seen:\nExpected: b\nFound:   \nChecked: d\nDid: left').problems(), [
    '`Seen:` says nothing: say what you saw, the fact and not what you conclude from it, or that it is unknown.',
    '`Found:` says nothing: say what you were doing and what alerted you, or that it is unknown.',
  ])
})

test('a keyword given twice is a problem, whatever each one says', () => {
  assert.deepEqual(new FlagText(`${FLAG_BODY}\nSeen: and another thing\nseen: and a third`).problems(), [
    '`Seen:` is given 3 times: give it once.',
  ])
})

test('Did starts with one of its three values, in a long or a short form, and what follows is its note', () => {
  const read = (did: string) => {
    const fields = new FlagText(body({ Did: did })).fields()

    return [fields?.did, fields?.didNote]
  }

  assert.deepEqual(read('left as it is.'), ['left', null])
  assert.deepEqual(read('left'), ['left', null])
  assert.deepEqual(read('Left as it is: it is not in my task.'), ['left', 'it is not in my task.'])
  assert.deepEqual(read('worked around, by calling refresh() myself\nin the test.'), [
    'worked-around',
    'by calling refresh() myself\nin the test.',
  ])
  assert.deepEqual(read('fixed in the task'), ['fixed', null])
  assert.deepEqual(read('fixed - see src/auth/token.ts'), ['fixed', 'see src/auth/token.ts'])
})

test('a Did that starts with anything else is a problem that quotes it and gives the values', () => {
  assert.deepEqual(new FlagText(body({ Did: 'nothing yet' })).problems(), [
    '`Did:` starts with "nothing yet": start it with `left as it is`, `worked around` or `fixed in the task`, then add what you want.',
  ])
  assert.equal(new FlagText(body({ Did: 'leftover code removed' })).problems().length, 1, 'a word that only begins like a value')
})

test('a flag with a problem has no fields', () => {
  assert.equal(new FlagText(body({ Checked: '(none)' })).fields(), null)
  assert.equal(new FlagText(body({ Did: 'nothing yet' })).fields(), null)
  assert.equal(new FlagText('').fields(), null)
})

test('the format shown to an agent is one a flag can be copied from', () => {
  const [command, ...lines] = FlagText.FORMAT.split('\n')
  const example = lines.slice(0, lines.indexOf('EOF')).join('\n')

  assert.match(command ?? '', /^weaver flag <file>\[:<line>\] \.\.\. <<'EOF'$/)
  assert.deepEqual(new FlagText(example).problems(), [])
  assert.equal(new FlagText(example).fields()?.did, 'left')
})
