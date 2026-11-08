import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { InstalledRelease } from '../../../src/lib/releases/installed-release.ts'
import { compareVersions } from '../../../src/lib/releases/release-version.ts'
import { writeFiles } from '../../fixtures/repo.ts'

const scratch = mkdtempSync(join(tmpdir(), 'weaver-releases-'))

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

function release(root: string, version: string): string {
  const dir = join(root, `v${version}`)

  writeFiles(dir, { 'package.json': JSON.stringify({ name: '@weaver/cli', version }), 'dist/bin/weaver.js': '#!/bin/sh\nexit 99\n' })
  chmodSync(join(dir, 'dist/bin/weaver.js'), 0o755)

  return dir
}

test('numeric versions and prereleases compare in release order', () => {
  for (const [older, newer] of [
    ['0.9.5', '0.10.0'],
    ['1.0.0-rc.2', '1.0.0-rc.10'],
    ['1.0.0-rc.10', '1.0.0'],
    ['1.0.0-1', '1.0.0-alpha'],
  ]) {
    assert.ok((compareVersions(older ?? '', newer ?? '') ?? 0) < 0)
  }
  assert.equal(compareVersions('garbage', '1.0.0'), null)
})

test('finds the newest installed release even when PATH selects an older version; never runs it', () => {
  const root = join(scratch, 'installed')
  const old = release(root, '0.9.5')

  release(root, '0.10.0')
  writeFiles(join(root, 'v99.0.0'), { 'package.json': '{broken' })
  mkdirSync(join(scratch, 'bin'))
  symlinkSync(join(old, 'dist/bin/weaver.js'), join(scratch, 'bin/weaver'))
  const installed = new InstalledRelease(root, join(scratch, 'bin'))

  assert.equal(installed.laterThan('0.9.4'), '0.10.0')
  assert.equal(installed.laterThan('0.10.0'), null)
  assert.equal(installed.laterThan('0.0.0-dev'), null)
  assert.equal(
    new InstalledRelease(join(scratch, 'missing'), join(scratch, 'bin')).laterThan('0.9.4'),
    '0.10.0',
    'custom root discovered through PATH',
  )
})

test('a PATH wrapper shadows later entries without being executed or mistaken for Weaver', () => {
  const root = join(scratch, 'shadowed')
  const installed = release(root, '3.0.0')

  writeFiles(join(scratch, 'wrapper'), { weaver: '#!/bin/sh\nexit 99\n' })
  chmodSync(join(scratch, 'wrapper/weaver'), 0o755)
  mkdirSync(join(scratch, 'other-bin'))
  symlinkSync(join(installed, 'dist/bin/weaver.js'), join(scratch, 'other-bin/weaver'))
  assert.equal(new InstalledRelease(join(scratch, 'absent'), `${scratch}/wrapper:${scratch}/other-bin`).laterThan('1.0.0'), null)
})
