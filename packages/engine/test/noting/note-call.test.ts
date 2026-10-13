import assert from 'node:assert/strict'
import { test } from 'vitest'
import { AgentCatalog } from '../../src/agents/runtimes/agent-catalog.ts'
import { Payload } from '../../src/agents/events/payload.ts'
import { NoteCall } from '../../src/noting/calls/note-call.ts'

const claude = new AgentCatalog().fromArguments(['--agent=claude'])
const BODY = 'Ran the test of the token:\n\n    401 Unauthorized\n'

function noteIn(command: string): NoteCall | null {
  const { call } = claude.read(new Payload({ cwd: '/repo', tool_name: 'Bash', tool_input: { command } }))

  return call === null ? null : NoteCall.in(call)
}

test('a note is the command that runs weaver with note as its first word, with what follows it and what it is given to read', () => {
  for (const program of ['weaver', '/opt/weaver/bin/weaver', 'node /opt/weaver/bin/weaver.js']) {
    const note = noteIn(`${program} note 12 confirmed <<'EOF'\n${BODY}EOF`)

    assert.deepEqual([note?.words, note?.body], [['12', 'confirmed'], BODY], program)
  }

  assert.deepEqual(noteIn('cd src && weaver note 12 "to look at later"')?.words, ['12', 'to look at later'])
  assert.equal(noteIn('weaver note 12 unsure the test needs a database')?.body, null)
  assert.equal(noteIn('weaver note 12 fixed <<-EOF\n\tin the store\n\tEOF')?.body, 'in the store\n')
})

test('a command that only names a note is not one', () => {
  for (const command of ['weaver cards 12', 'weaver cards note', 'echo weaver note 12 confirmed', 'git note 12', 'cat notes/weaver note']) {
    assert.equal(noteIn(command), null, command)
  }
})
