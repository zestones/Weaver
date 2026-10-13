import assert from 'node:assert/strict'
import { test } from 'vitest'
import { NoteText } from '../../src/notes/note-text.ts'

const read = (words: readonly string[], body: string | null = null) => {
  const { card, conclusion, text } = new NoteText(words, body)

  return { card, conclusion, text }
}

test('a note names its card first, then what it concludes if it does, then what it says', () => {
  assert.deepEqual(read(['12', 'confirmed', 'ran', 'the', 'test']), { card: 12, conclusion: 'confirmed', text: 'ran the test' })
  assert.deepEqual(read(['12', 'to look at with the next release']), {
    card: 12,
    conclusion: null,
    text: 'to look at with the next release',
  })
  assert.deepEqual(
    NoteText.CONCLUSIONS.map((word) => read(['3', word, 'x']).conclusion),
    ['confirmed', 'refuted', 'unsure', 'fixed'],
  )
  assert.deepEqual(
    read(['12', 'Confirmed', 'it']),
    { card: 12, conclusion: null, text: 'Confirmed it' },
    'a word of the note is not a conclusion',
  )
})

test('what the command was given to read is the text of the note, after what its line says', () => {
  assert.deepEqual(read(['12', 'refuted'], '\nThe commit is rolled back:\n\n    ROLLBACK\n'), {
    card: 12,
    conclusion: 'refuted',
    text: 'The commit is rolled back:\n\n    ROLLBACK',
  })
  assert.equal(read(['12', 'fixed', 'in one line'], 'and what follows').text, 'in one line\n\nand what follows')
})

test('a note without the number of a card, or that says nothing, has a problem that says what to write', () => {
  assert.deepEqual(new NoteText(['12', 'unsure', 'the test needs a database'], null).problems(), [])
  assert.deepEqual(new NoteText(['confirmed', 'it fails'], null).problems(), [
    'The note names no card: the number of the card comes first.',
  ])
  assert.deepEqual(new NoteText(['12', 'confirmed'], '  \n'), new NoteText(['12', 'confirmed'], null))
  assert.deepEqual(new NoteText(['12', 'confirmed'], null).problems(), ['The note says nothing: say what you did, and what it showed.'])
  assert.deepEqual(new NoteText([], null).problems().length, 2)
})

test('the format shown to an agent is one a note can be copied from, with the number of the card it reads', () => {
  const [command = '', said = '', end = ''] = NoteText.formatFor('12').split('\n')
  const [number = '', conclusions = ''] = command.replace('weaver note ', '').split(' ')

  assert.equal(command, "weaver note 12 confirmed|refuted|unsure|fixed <<'EOF'")
  assert.equal(end, 'EOF')
  assert.deepEqual(read([number, conclusions.split('|')[1] ?? ''], said), {
    card: 12,
    conclusion: 'refuted',
    text: 'What you ran and what it showed, what you only read, and what you changed.',
  })
  assert.match(NoteText.FORMAT, /^weaver note <number> /)
})
