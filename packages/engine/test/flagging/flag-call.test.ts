import assert from 'node:assert/strict'
import { test } from 'vitest'
import { AgentCatalog } from '../../src/agents/runtimes/agent-catalog.ts'
import { Payload } from '../../src/agents/events/payload.ts'
import { FlagCall } from '../../src/flagging/calls/flag-call.ts'

const TOP = '/repo'
const claude = new AgentCatalog().fromArguments(['--agent=claude'])
const BODY = 'Seen: a\nExpected: b\nFound: c\nChecked: d\nDid: left as it is.\n'

function flagIn(command: string, tool = 'Bash'): FlagCall | null {
  const { call } = claude.read(new Payload({ cwd: TOP, tool_name: tool, tool_input: { command, file_path: '/repo/a.ts' } }))

  return call === null ? null : FlagCall.in(call)
}

test('a flag is the command that runs weaver with flag as its first word, by its name, by a path or through node', () => {
  for (const program of [
    'weaver',
    '/opt/weaver/bin/weaver',
    './bin/weaver.js',
    'node /opt/weaver/bin/weaver.js',
    'node --no-warnings ../cli/weaver',
  ]) {
    const flag = flagIn(`${program} flag src/a.ts:12 src/b.ts <<'EOF'\n${BODY}EOF`)

    assert.deepEqual([flag?.places, flag?.body, flag?.cwd], [['src/a.ts:12', 'src/b.ts'], BODY, TOP], program)
  }

  for (const command of [
    'weaver cards',
    'weaver cards flag',
    'echo weaver flag src/a.ts',
    'git flag src/a.ts',
    'node tools/other.js flag src/a.ts',
    'node --test weaver.test.js flag',
    'cat notes/weaver flag',
  ]) {
    assert.equal(flagIn(command), null, command)
  }

  assert.equal(flagIn('weaver flag src/a.ts', 'Edit'), null, 'only a shell call runs a command')
})

test('the places are the words after flag, options left out; a flag may name none', () => {
  assert.deepEqual(flagIn('weaver flag --verbose src/a.ts -q "src/with space.ts:3"')?.places, ['src/a.ts', 'src/with space.ts:3'])
  assert.deepEqual(flagIn(`weaver flag <<'EOF'\n${BODY}EOF`)?.places, [])
})

test('the body is the heredoc of that command, word for word, and nothing when it has none', () => {
  const quoted = 'Seen: "two" names, it\'s `one` and $HOME.\n'

  assert.equal(flagIn(`weaver flag a.ts <<'EOF'\n${quoted}EOF`)?.body, quoted)
  assert.equal(flagIn(`weaver flag a.ts <<EOF\n${quoted}EOF`)?.body, quoted, 'nothing is expanded')
  assert.equal(
    flagIn(`weaver flag a.ts <<-EOF\n\tSeen: a\n\t\tExpected: b\n\tEOF`)?.body,
    'Seen: a\nExpected: b\n',
    'as the shell gives it',
  )
  assert.equal(flagIn(`echo first && weaver flag a.ts <<'EOF'\n${BODY}EOF\necho after`)?.body, BODY)
  assert.equal(flagIn('weaver flag a.ts')?.body, null)
  assert.equal(flagIn("weaver flag a.ts <<< 'Seen: a'")?.body, null, 'a here-string is not a heredoc')
  assert.equal(flagIn(`cat <<'EOF' | weaver flag a.ts\n${BODY}EOF`)?.body, null, 'the heredoc of another command')
})

test('a flag runs where the commands before it left the shell, and through the wrappers that run it', () => {
  assert.equal(flagIn('cd src && echo before && weaver flag one.js:1')?.cwd, '/repo/src')
  assert.equal(flagIn('cd /elsewhere; weaver flag one.js')?.cwd, '/elsewhere')
  assert.equal(flagIn('cd "$DIR" && weaver flag one.js')?.cwd, null, 'a directory only the shell knows')
  assert.deepEqual(flagIn(`timeout 5 env A=1 weaver flag one.js <<'EOF'\n${BODY}EOF`)?.body, BODY)
  assert.deepEqual(flagIn(`pnpm exec weaver flag one.js <<'EOF'\n${BODY}EOF`)?.places, ['one.js'])
})
