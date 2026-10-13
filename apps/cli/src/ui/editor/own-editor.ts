import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const FALLBACK = 'vi'
const FILE = 'note.md'

// The editor the owner works in, named as git and every other tool find it: `VISUAL`, then `EDITOR`.
export class OwnEditor {
  private readonly command: string

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.command = (env.VISUAL ?? '').trim() || (env.EDITOR ?? '').trim() || FALLBACK
  }

  // The text as the owner saved it. The editor takes the terminal while it runs: whoever calls gives it up first.
  edit(text: string): string {
    const folder = mkdtempSync(join(tmpdir(), 'weaver-note-'))
    const file = join(folder, FILE)

    try {
      writeFileSync(file, text)

      // The command may carry its own options, as `code --wait` does: a shell reads it as the owner wrote it, and is
      // given the file as its first argument.
      const result = spawnSync('sh', ['-c', `${this.command} "$1"`, 'weaver', file], { stdio: 'inherit' })

      if (result.status !== 0) throw new Error(`${this.command} ended with the status ${String(result.status)}: the note is as it was`)

      return readFileSync(file, 'utf8')
    } finally {
      rmSync(folder, { recursive: true, force: true })
    }
  }
}
