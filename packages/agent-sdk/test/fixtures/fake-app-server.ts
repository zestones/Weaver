import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// A stand-in for the app server of a runtime: it reads one message a line, and `body` answers each. The body is given
// the `message`, a `say` that writes one back, and the methods `heard` so far.
export function fakeAppServer(dir: string, name: string, body: string): string {
  const path = join(dir, name)

  mkdirSync(dir, { recursive: true })
  writeFileSync(
    path,
    `#!/usr/bin/env node
const argv = process.argv.slice(2)
const say = (message) => console.log(JSON.stringify(message))
const heard = []
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  heard.push(message.method)
${body}
})
`,
  )
  chmodSync(path, 0o755)

  return path
}
