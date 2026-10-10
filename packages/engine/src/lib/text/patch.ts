import { isAbsolute, resolve } from 'node:path'

// The patch format of Codex's `apply_patch`: one header per file, then its lines.
export const PATCH_BEGIN = '*** Begin Patch'
const PATCH_END = '*** End Patch'
const MOVE = '*** Move to: '
const HEADERS = [
  { op: 'add', prefix: '*** Add File: ' },
  { op: 'delete', prefix: '*** Delete File: ' },
  { op: 'update', prefix: '*** Update File: ' },
] as const

export interface PatchedFile {
  readonly op: 'add' | 'delete' | 'update'
  readonly path: string
  readonly movePath: string | null
}

function headerOf(line: string): PatchedFile | null {
  const header = HEADERS.find(({ prefix }) => line.startsWith(prefix))

  return header === undefined ? null : { op: header.op, path: line.slice(header.prefix.length).trim(), movePath: null }
}

export function patchedFiles(text: string): PatchedFile[] {
  const start = text.indexOf(PATCH_BEGIN)

  if (start === -1) return []

  const end = text.indexOf(PATCH_END, start)
  const body = text.slice(start + PATCH_BEGIN.length, end === -1 ? text.length : end)
  const files: PatchedFile[] = []

  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/\r$/, '').trim()
    const header = headerOf(line)
    const current = files.at(-1)

    if (header !== null) files.push(header)
    else if (current?.op === 'update' && line.startsWith(MOVE))
      files[files.length - 1] = { ...current, movePath: line.slice(MOVE.length).trim() }
  }

  return files
}

export function patchedPaths(text: string, cwd: string): string[] {
  return patchedFiles(text)
    .flatMap((file) => (file.movePath === null ? [file.path] : [file.path, file.movePath]))
    .map((path) => (isAbsolute(path) ? path : resolve(cwd, path)))
}
