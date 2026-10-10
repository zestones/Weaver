import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'vitest'

const PACKAGE = join(import.meta.dirname, '../..')
const EXCEPTIONS = new Set<string>()

function mixedFolders(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const folders = entries.filter((entry) => entry.isDirectory())
  const files = entries.filter((entry) => entry.isFile() && !EXCEPTIONS.has(relative(PACKAGE, join(dir, entry.name))))
  const here = folders.length > 0 && files.length > 0 ? [relative(PACKAGE, dir)] : []

  return [...here, ...folders.flatMap((folder) => mixedFolders(join(dir, folder.name)))]
}

test('a folder holds sub-folders or files, never both', () => {
  assert.deepEqual([...mixedFolders(join(PACKAGE, 'src')), ...mixedFolders(join(PACKAGE, 'test'))], [])
})
