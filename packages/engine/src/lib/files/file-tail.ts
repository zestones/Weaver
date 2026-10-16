import { closeSync, fstatSync, openSync, readSync } from 'node:fs'

// The last bytes of a file, as text: what a log that only grows says last, without reading all of it. The first line
// may be cut. Empty when the file cannot be read.
export function fileTail(path: string, bytes: number): string {
  let fd: number

  try {
    fd = openSync(path, 'r')
  } catch {
    return ''
  }

  try {
    const size = fstatSync(fd).size
    const length = Math.min(size, bytes)
    const buffer = Buffer.alloc(length)

    readSync(fd, buffer, 0, length, size - length)

    return buffer.toString('utf8')
  } catch {
    return ''
  } finally {
    closeSync(fd)
  }
}
