import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { cardOf, flag, inRegistry, write } from '../fixtures/cards.ts'
import { makeProject, weaver } from '../fixtures/project.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-owner-'))
const top = makeProject(join(scratch, 'project'))
const OWNERS: readonly (readonly string[])[] = [
  ['install'],
  ['uninstall'],
  ['update', '--offline'],
  ['maintenance', 'on'],
  ['close', '1', 'fixed'],
  ['cards', 'reopen', '2'],
  ['cards', 'retitle', '1', 'Another', 'title'],
  ['cards', 'label', '1', 'type:bug'],
  ['cards', 'rewrite', '1'],
  ['cards', 'tie', '1', '2'],
  ['cards', 'untie', '1', '3'],
  ['cards', 'separate', '4'],
  ['ui'],
]

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

test('what decides or changes is the owner’s: under an agent it does not run, and says whose it is', async () => {
  flag(top)
  write(top, 1)
  for (const session of ['session-2', 'session-3', 'session-4']) flag(top, { provenance: { ...cardOf(top, 1).record.provenance, session } })
  inRegistry(top, (registry) => {
    registry.closeCard(2, 'fixed', null)
    registry.tie(1, 3, null)
    registry.merge(4, 1, 'the same')
  })

  const before = [1, 2, 3, 4].map((number) => cardOf(top, number).record)

  for (const words of OWNERS) {
    const name = words[0] === 'cards' ? words.slice(0, 2).join(' ') : words[0]

    for (const agent of ['claude', 'codex']) {
      assert.deepEqual(
        await weaver(top, words, { under: agent, input: '## Observation\n\nRewritten.\n' }),
        {
          status: 1,
          lines: [
            `X weaver ${String(name)} is the owner's: it decides or changes something, so it runs from a terminal of their own, and not under ${agent}.`,
          ],
        },
        words.join(' '),
      )
    }
  }

  assert.deepEqual(
    [1, 2, 3, 4].map((number) => cardOf(top, number).record),
    before,
  )
  assert.equal(existsSync(join(top, '.weaver')), false)
  assert.equal(existsSync(join(top, '.claude')), false)
})

test('an agent may read: the list, a card, and the doctor', async () => {
  assert.equal((await weaver(top, ['cards'], { under: 'claude' })).lines[0], '2 cards wait for you')
  assert.equal((await weaver(top, ['cards', '--all'], { under: 'codex' })).lines[0], '4 cards')
  assert.ok((await weaver(top, ['cards', '1'], { under: 'codex' })).lines.join('\n').startsWith(`${cardOf(top, 1).markdown()}\n\n---\n`))
  assert.ok((await weaver(top, ['doctor'], { under: 'claude' })).lines.includes('  ✓ The registry: 2 cards wait for you'))
  assert.equal((await weaver(top, [], { under: 'claude' })).status, 0)
})
