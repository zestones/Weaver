import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DeclarationFolder } from '@weaver/engine'
import { afterAll, beforeEach, test } from 'vitest'
import { EngineLink } from '../../src/link/engine-link.ts'
import { OwnRelease } from '../../src/link/own-release.ts'
import { ReleaseChannel } from '../../src/releases/release-channel.ts'
import { ReleaseInstaller } from '../../src/releases/release-installer.ts'
import type { PublishedRelease, ReleaseSource } from '../../src/releases/release-source.ts'
import { RuntimeCatalog } from '../../src/runtimes/runtime-catalog.ts'
import { makeProject, readJson, SETTINGS, weaver, writeConfig, writeJson } from '../fixtures/project.ts'

// The script every release carries, as this repository holds it.
const INSTALL_SH = join(import.meta.dirname, '../../../../tools/release/install.sh')
const TAG = 'v9.9.9'
const ARCHIVE = `weaver-${TAG}.tar.gz`
const CLAUDE = '.claude/settings.local.json'
// A later release reduced to what an update asks of it: it says its version, and it records how it was asked to
// finish the update, or to say what it would change.
const LATER = `#!/usr/bin/env node
const [command, ...args] = process.argv.slice(2)
if (command === 'version') console.log('weaver 9.9.9')
if (command === 'update') {
  require('node:fs').writeFileSync('handed-over.txt', args.join(' '))
  console.log(args.includes('--dry-run') ? '- .weaver/ would be brought up to date:' : 'This project is up to date with Weaver v9.9.9.')
}
`
// What the publisher of a release writes of it: how it is installed, then what changed.
const NOTES = '## Install\n\nWeaver needs Node.js.\n\n## What changed since v0.1.0\n\n### Features\n\n- add a thing (abc1234)\n'
// A project as the first format wrote it, wired by the release of that time.
const FIRST_SETTINGS = { version: 1, checks: { maxRefusals: 5, totalTimeoutSeconds: 600, parallel: 2 } }
const FIRST_CHECKS = {
  format: {
    fix: ['npx', 'prettier', '--write', '{files}'],
    verify: ['npx', 'prettier', '--check', '{files}'],
    cwd: '.',
    reads: 'exit',
    timeoutSeconds: 120,
    rules: { formatted: 'Prettier decides formatting.' },
  },
}
const OLDER_HOOK =
  '"/usr/bin/node" "/home/someone/.local/share/weaver/v0.1.0/node_modules/@weaver/engine/dist/bin/hook.js" Stop --agent=claude --weaver'
const scratch = mkdtempSync(join(tmpdir(), 'weaver-cli-update-'))
const link = new EngineLink()
let top: string
let home: string
let bin: string
let published: string
let counter = 0

class LocalReleases implements ReleaseSource {
  asked = 0
  fetched = 0
  private readonly folder: string
  private readonly names: readonly string[]
  private readonly reachable: boolean
  private readonly notes: string

  constructor(folder: string, names: readonly string[], reachable: boolean, notes: string) {
    this.folder = folder
    this.names = names
    this.reachable = reachable
    this.notes = notes
  }

  latest(): Promise<PublishedRelease> {
    this.asked += 1

    return this.reachable
      ? Promise.resolve({ tag: TAG, notes: this.notes, assets: new Map(this.names.map((name) => [name, join(this.folder, name)])) })
      : Promise.reject(new Error('the releases of zestones/Weaver could not be read: no network'))
  }

  fetch(release: PublishedRelease, name: string, to: string): Promise<void> {
    const from = release.assets.get(name)

    if (from === undefined) return Promise.reject(new Error(`the release ${release.tag} has no ${name}`))

    this.fetched += 1
    copyFileSync(from, to)

    return Promise.resolve()
  }
}

interface Machine {
  readonly names?: readonly string[]
  readonly reachable?: boolean
  readonly notes?: string
}

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

beforeEach(() => {
  counter += 1

  const root = join(scratch, `case-${String(counter)}`)
  const content = join(root, 'content', `weaver-${TAG}`)

  top = makeProject(join(root, 'project'))
  home = join(root, 'share')
  bin = join(root, 'bin')
  published = join(root, 'published')
  mkdirSync(join(content, 'dist/bin'), { recursive: true })
  mkdirSync(published, { recursive: true })
  writeFileSync(join(content, 'package.json'), '{ "version": "9.9.9" }\n')
  writeFileSync(join(content, 'dist/bin/weaver.js'), LATER)
  chmodSync(join(content, 'dist/bin/weaver.js'), 0o755)
  execFileSync('tar', ['-czf', join(published, ARCHIVE), '-C', join(root, 'content'), `weaver-${TAG}`])
  writeFileSync(
    join(published, 'SHA256SUMS'),
    `${createHash('sha256')
      .update(readFileSync(join(published, ARCHIVE)))
      .digest('hex')}  ${ARCHIVE}\n`,
  )
  copyFileSync(INSTALL_SH, join(published, 'install.sh'))
})

// The machine as an update sees it: the release that runs, the releases published in a folder, a home of these tests.
function channel(version: string, machine: Machine = {}): ReleaseChannel {
  const files = machine.names ?? [ARCHIVE, 'SHA256SUMS', 'install.sh']
  const source = new LocalReleases(published, files, machine.reachable ?? true, machine.notes ?? '')

  return new ReleaseChannel(source, new ReleaseInstaller({ ...process.env, WEAVER_HOME: home, WEAVER_BIN: bin }), new OwnRelease(version))
}

const sourceOf = (releases: ReleaseChannel): LocalReleases => releases.source as LocalReleases
const handedOver = (): string | null =>
  existsSync(join(top, 'handed-over.txt')) ? readFileSync(join(top, 'handed-over.txt'), 'utf8') : null

function firstFormatProject(): void {
  writeJson(top, '.weaver/settings.json', FIRST_SETTINGS)
  writeJson(top, '.weaver/project/checks.json', FIRST_CHECKS)
  writeJson(top, CLAUDE, { hooks: { Stop: [{ hooks: [{ type: 'command', command: OLDER_HOOK }] }] } })
}

test('update installs a later release with the script it carries, then lets that release finish: it knows its own format', async () => {
  firstFormatProject()

  const { status, lines } = await weaver(top, ['update'], { channel: channel('0.1.0') })

  assert.equal(status, 0, lines.join('\n'))
  assert.equal(realpathSync(join(bin, 'weaver')), realpathSync(join(home, TAG, 'dist/bin/weaver.js')))
  assert.match(lines[0] ?? '', /^weaver 9\.9\.9 is installed in .*share\/v9\.9\.9, and .*bin\/weaver points at it\.$/)
  assert.equal(lines.at(-1), 'This project is up to date with Weaver v9.9.9.')
  assert.equal(handedOver(), '--offline', 'the release it installed is asked to finish, without looking for a release again')
  assert.deepEqual(
    readJson(top, '.weaver/settings.json'),
    FIRST_SETTINGS,
    'the release that fetched does not touch a format it may not know',
  )
})

test('a release whose archive does not match its checksum is not installed, and the project is left as it is', async () => {
  firstFormatProject()
  writeFileSync(join(published, 'SHA256SUMS'), `${'0'.repeat(64)}  ${ARCHIVE}\n`)

  const { status, lines } = await weaver(top, ['update'], { channel: channel('0.1.0') })

  assert.equal(status, 1)
  assert.match(lines.join('\n'), /does not match the SHA256SUMS beside it: nothing is installed/)
  assert.equal(existsSync(join(home, TAG)), false)
  assert.equal(handedOver(), null)
})

test('with the latest release, update brings the project up to date itself: its migrations, then the hooks that were wired', async () => {
  firstFormatProject()

  const first = await weaver(top, ['update'], { channel: channel('9.9.9') })

  assert.equal(first.status, 0, first.lines.join('\n'))
  assert.deepEqual(first.lines, [
    '✓ Weaver v9.9.9 is the latest release.',
    '✓ .weaver/ brought up to date:',
    '  0002-check-commands: The commands of a check are named for what they do, and a check may warn right after a call.',
    '    project/checks.json: `fix` is now `repair`, in 1 place',
    '    project/checks.json: `verify` is now `judge`, in 1 place',
    '    settings.json: checks.warnTimeoutSeconds added, at 30: the seconds the checks that warn are given after one call',
    '✓ Claude Code: hooks written again in .claude/settings.local.json, which were those of Weaver v0.1.0',
    '✓ Claude Code: the guide of Weaver written to .claude/skills/weaver/SKILL.md',
    '✓ Claude Code: the mod that shows the end of a task in its chat written to .claude/skills/weaver-status',
  ])
  assert.deepEqual(DeclarationFolder.in(top).load()?.checks[0]?.repair, ['npx', 'prettier', '--write', '{files}'])
  assert.deepEqual(
    new RuntimeCatalog().settings(top, link, []).map((runtime) => runtime.wiring()),
    ['installed', 'absent'],
    'a runtime that was not wired is not plugged in by an update',
  )
  assert.deepEqual((await weaver(top, ['update'], { channel: channel('9.9.9') })).lines, [
    '✓ Weaver v9.9.9 is the latest release.',
    '✓ This project is up to date with Weaver v9.9.9.',
  ])
})

test('update writes the guide of a wired runtime again once the project declares something else', async () => {
  await weaver(top, ['install', 'claude'])
  writeConfig(top, { checks: { lint: { cwd: '.', reads: 'exit', timeoutSeconds: 60, judge: ['true'], rules: { L1: 'The code lints.' } } } })

  const { lines } = await weaver(top, ['update'], { channel: channel('9.9.9') })

  assert.deepEqual(lines.slice(1), ['✓ Claude Code: the guide of Weaver written again in .claude/skills/weaver/SKILL.md'])
  assert.match(
    readFileSync(join(top, '.claude/skills/weaver/SKILL.md'), 'utf8'),
    /\n- `lint`: runs on any change; it may take up to 1 min\.\n/,
  )
  assert.equal(existsSync(join(top, '.agents/skills/weaver')), false, 'a runtime that is not wired gets no guide')
})

test('update writes the mod again when it is not the one of this Weaver', async () => {
  await weaver(top, ['install', 'claude'])
  writeFileSync(join(top, '.claude/skills/weaver-status/hooks/register.tsx'), 'export const register = () => {}\n')

  const { lines } = await weaver(top, ['update'], { channel: channel('9.9.9') })

  assert.deepEqual(lines.slice(1), [
    '✓ Claude Code: the mod that shows the end of a task in its chat written again in .claude/skills/weaver-status',
  ])
  assert.match(readFileSync(join(top, '.claude/skills/weaver-status/hooks/register.tsx'), 'utf8'), /on\('classic\.Stop'/)
})

test('update leaves a skill named weaver that Weaver did not write as it is, and says so', async () => {
  const mine = '---\nname: weaver\n---\nMine.\n'

  await weaver(top, ['install', 'claude'])
  writeFileSync(join(top, '.claude/skills/weaver/SKILL.md'), mine)

  const { lines } = await weaver(top, ['update'], { channel: channel('9.9.9') })

  assert.ok(
    lines.includes('! Claude Code: .claude/skills/weaver/SKILL.md is a skill named weaver that Weaver did not write: it is left as it is.'),
    lines.join('\n'),
  )
  assert.equal(readFileSync(join(top, '.claude/skills/weaver/SKILL.md'), 'utf8'), mine)
})

test('a dry run says what an update would do and writes nothing, in the project or on the machine', async () => {
  firstFormatProject()

  const hooks = readFileSync(join(top, CLAUDE), 'utf8')
  const here = await weaver(top, ['update', '--dry-run'], { channel: channel('9.9.9') })

  assert.equal(here.status, 0)
  assert.equal(here.lines[1], '- .weaver/ would be brought up to date:')
  assert.deepEqual(here.lines.slice(-3), [
    '- Claude Code: hooks would be written again in .claude/settings.local.json, which were those of Weaver v0.1.0',
    '- Claude Code: the mod that shows the end of a task in its chat would be written to .claude/skills/weaver-status',
    'Dry run: nothing was written.',
  ])
  assert.equal(existsSync(join(top, '.claude/skills/weaver-status')), false)
  assert.deepEqual(readJson(top, '.weaver/settings.json'), FIRST_SETTINGS)
  assert.equal(readFileSync(join(top, CLAUDE), 'utf8'), hooks)
})

test('a dry run from an earlier release shows what the later one says changed, and asks it what it would change here', async () => {
  firstFormatProject()

  const later = channel('0.1.0', { notes: NOTES })
  const dry = await weaver(top, ['update', '--dry-run'], { channel: later })

  assert.deepEqual(dry, {
    status: 0,
    lines: [
      '- Weaver v9.9.9 is published, and this is v0.1.0: it would be installed.',
      '',
      'What changed since v0.1.0',
      '',
      'Features',
      '  - add a thing (abc1234)',
      '',
      'What Weaver v9.9.9 would change in this project',
      '  - .weaver/ would be brought up to date:',
    ],
  })
  assert.equal(handedOver(), '--dry-run --offline', 'the later release is asked for its own dry run')
  assert.equal(sourceOf(later).fetched, 2, 'its archive and its sums: the script that installs is not fetched')
  assert.equal(existsSync(home), false, 'nothing is installed')
  assert.deepEqual(readJson(top, '.weaver/settings.json'), FIRST_SETTINGS)

  const silent = await weaver(top, ['update', '--dry-run'], { channel: channel('0.1.0') })

  assert.deepEqual(silent.lines.slice(0, 3), [
    '- Weaver v9.9.9 is published, and this is v0.1.0: it would be installed.',
    '',
    'What Weaver v9.9.9 would change in this project',
  ])
})

test('a dry run runs nothing of an archive that is not the one its release published', async () => {
  writeConfig(top, { settings: SETTINGS })
  writeFileSync(join(published, 'SHA256SUMS'), `${'0'.repeat(64)}  ${ARCHIVE}\n`)

  assert.deepEqual(await weaver(top, ['update', '--dry-run'], { channel: channel('0.1.0') }), {
    status: 1,
    lines: [
      '- Weaver v9.9.9 is published, and this is v0.1.0: it would be installed.',
      'X Weaver v9.9.9 could not be asked what it would change.',
      `  ${ARCHIVE} does not match the SHA256SUMS of its release: nothing of it is run.`,
    ],
  })
  assert.equal(handedOver(), null)

  const lacking = await weaver(top, ['update', '--dry-run'], { channel: channel('0.1.0', { names: [ARCHIVE] }) })

  assert.deepEqual(lacking.lines.at(-1), 'X The release v9.9.9 has no SHA256SUMS')
  assert.equal(lacking.status, 1)
})

test('update looks for no release when it is told so, when GitHub does not answer, or from a checkout, and still brings the project up to date', async () => {
  writeConfig(top, { settings: SETTINGS })

  const offline = channel('0.1.0')

  assert.deepEqual((await weaver(top, ['update', '--offline'], { channel: offline })).lines, [
    '✓ This project is up to date with Weaver v0.1.0.',
  ])
  assert.equal(sourceOf(offline).asked, 0)

  assert.deepEqual((await weaver(top, ['update'], { channel: channel('0.1.0', { reachable: false }) })).lines, [
    '! No release was looked for: the releases of zestones/Weaver could not be read: no network. Weaver stays at v0.1.0.',
    '✓ This project is up to date with Weaver v0.1.0.',
  ])

  const checkout = channel('0.0.0-dev')

  assert.deepEqual((await weaver(top, ['update'], { channel: checkout })).lines, [
    '- Weaver runs from a checkout, which git updates: no release is looked for.',
    '✓ This project is up to date with Weaver v0.0.0-dev.',
  ])
  assert.equal(sourceOf(checkout).asked, 0)
})

test('update says so where there is no supervised project, and refuses a configuration no release it found can read', async () => {
  const nowhere = await weaver(top, ['update'], { channel: channel('9.9.9') })

  assert.equal(nowhere.status, 0)
  assert.equal(nowhere.lines.at(-1), '- No supervised project here: weaver install puts Weaver on a project.')

  writeJson(top, '.weaver/settings.json', { ...SETTINGS, version: 3 })

  const ahead = await weaver(top, ['update'], { channel: channel('9.9.9') })

  assert.equal(ahead.status, 1)
  assert.equal(ahead.lines.at(-1), 'X .weaver/ is in a later format than Weaver v9.9.9 reads, and no later release was installed.')
})

test('update is the owner’s, knows its two options, and stops on a release that lacks a file', async () => {
  const agent = await weaver(top, ['update'], { channel: channel('0.1.0'), under: 'claude' })

  assert.equal(agent.status, 1)
  assert.match(agent.lines[0] ?? '', /^X weaver update is the owner's/)

  const unknown = await weaver(top, ['update', '--force'], { channel: channel('0.1.0') })

  assert.equal(unknown.status, 2)
  assert.match(unknown.lines[0] ?? '', /^X weaver update does not know --force\.$/)

  const lacking = await weaver(top, ['update'], { channel: channel('0.1.0', { names: [ARCHIVE, 'SHA256SUMS'] }) })

  assert.equal(lacking.status, 1)
  assert.deepEqual(lacking.lines, ['X The release v9.9.9 has no install.sh'])
  assert.equal(existsSync(join(home, TAG)), false)
})

test('a release knows whether another came after it', () => {
  const own = new OwnRelease('0.9.3')

  assert.equal(own.isOlderThan('v0.10.0'), true)
  assert.equal(own.isOlderThan('v1.0.0'), true)
  assert.equal(own.isOlderThan('v0.9.3'), false)
  assert.equal(own.isOlderThan('v0.9.2'), false)
  assert.equal(own.isOlderThan('nightly'), true, 'a tag that is not three numbers is what is published')
})
