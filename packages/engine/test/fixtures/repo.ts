import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Repository } from '../../src/lib/git/repository.ts'

const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0' }

export const SAMPLE_REPO: Readonly<Record<string, string>> = {
  '.gitignore': 'ignored/\n',
  'src/a.ts': 'export const a = 1\n',
  'package.json': '{"scripts":{"lint":"eslint ."}}\n',
}

export function git(top: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', top, ...args], { encoding: 'utf8', env: GIT_ENV }).trim()
}

export function writeFiles(top: string, files: Readonly<Record<string, string>>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(top, path)), { recursive: true })
    writeFileSync(join(top, path), content)
  }
}

export function locate(top: string): Repository {
  const repo = Repository.locate(top)

  if (repo === null) throw new Error(`no repository at ${top}`)

  return repo
}

export function makeRepo(top: string, files: Readonly<Record<string, string>> = { 'README.md': '# test\n' }): Repository {
  mkdirSync(top, { recursive: true })
  git(top, ['init', '-q', '-b', 'main'])
  git(top, ['config', 'user.email', 'test@example.com'])
  git(top, ['config', 'user.name', 'Test'])
  writeFiles(top, files)
  git(top, ['add', '-A'])
  git(top, ['commit', '-qm', 'initial'])

  return locate(top)
}
