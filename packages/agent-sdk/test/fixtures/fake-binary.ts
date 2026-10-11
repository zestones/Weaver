import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// A stand-in for an agent's command line: it answers by what the prompt, read on its standard input, asks for.
export function fakeBinary(dir: string, name: string, body: string): string {
  const path = join(dir, name)

  mkdirSync(dir, { recursive: true })
  writeFileSync(
    path,
    `#!/usr/bin/env node
const argv = process.argv.slice(2)
if (argv[0] === '--version') process.exit(0)
let asked = ''
process.stdin.on('data', (chunk) => { asked += chunk })
process.stdin.on('end', () => {
${body}
})
`,
  )
  chmodSync(path, 0o755)

  return path
}
