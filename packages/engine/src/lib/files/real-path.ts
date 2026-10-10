import { existsSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

// Symlinks are resolved on the part of the path that exists, so that a link cannot hide where a write lands.
export function realPath(path: string): string {
  let head = path
  const tail: string[] = []

  while (head !== dirname(head) && !existsSync(head)) {
    tail.unshift(head.slice(dirname(head).length + 1))
    head = dirname(head)
  }

  try {
    return resolve(realpathSync(head), ...tail)
  } catch {
    return path
  }
}
