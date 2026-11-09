import { closeSync, openSync, readSync } from 'node:fs'
import { StringDecoder } from 'node:string_decoder'

// Diff headers are short; a generated file may put megabytes on a single content line.
export function* linePrefixes(path: string, limit: number): Generator<string> {
  const file = openSync(path, 'r')
  const buffer = Buffer.alloc(64 * 1024)
  const decoder = new StringDecoder('utf8')
  let prefix = ''

  try {
    for (let size = readSync(file, buffer); size > 0; size = readSync(file, buffer)) {
      const text = decoder.write(buffer.subarray(0, size))
      let start = 0
      for (let end = text.indexOf('\n'); end !== -1; end = text.indexOf('\n', start)) {
        yield prefix + text.slice(start, Math.min(end, start + limit - prefix.length))
        prefix = ''
        start = end + 1
      }
      prefix += text.slice(start, start + limit - prefix.length)
    }
    prefix += decoder.end().slice(0, limit - prefix.length)
    if (prefix !== '') yield prefix
  } finally {
    closeSync(file)
  }
}
