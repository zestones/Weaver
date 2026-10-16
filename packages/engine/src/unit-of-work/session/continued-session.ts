import { existsSync, readdirSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileTail } from '../../lib/files/file-tail.ts'

// The mark of a continuation is one of the last lines of a transcript.
const TAIL_BYTES = 64 * 1024
const MARK = 'continued-in'

// Claude Code may go on with a session under a new id, as when it sends it to the background: the transcript of the
// session it leaves then ends with a line that names the new one. It is the same work: the new id takes over the state
// the session left, its unit of work, its maintenance and what it waits for.
export class ContinuedSession {
  private readonly root: string
  private readonly dir: string
  private readonly id: string
  // Where the runtime writes the transcripts of the project's sessions, side by side; null when it does not say.
  private readonly transcripts: string | null

  // `root` holds a folder for each session, `dir` is the one of this session, and `transcript` is where the runtime
  // writes what this session says.
  constructor(root: string, dir: string, id: string, transcript: string | null) {
    this.root = root
    this.dir = dir
    this.id = id
    this.transcripts = transcript === null ? null : dirname(transcript)
  }

  // The id of the session this one continues, once its state is moved here; null when it continues none. Only a
  // session met for the first time looks: the others already have their state.
  takeOver(): string | null {
    const { transcripts } = this

    if (transcripts === null || existsSync(this.dir) || !existsSync(this.root)) return null

    const left = readdirSync(this.root).find((other) => this.continuedIn(join(transcripts, `${other}.jsonl`)))

    if (left === undefined) return null

    try {
      renameSync(join(this.root, left), this.dir)
    } catch {
      // Another hook of this session moved it first.
      return null
    }

    return left
  }

  // Whether a transcript says its session went on as this one.
  private continuedIn(transcript: string): boolean {
    return fileTail(transcript, TAIL_BYTES)
      .split('\n')
      .some((line) => line.includes(MARK) && this.namesThis(line))
  }

  private namesThis(line: string): boolean {
    try {
      const entry = JSON.parse(line) as { type?: unknown; continuedInSessionId?: unknown }

      return entry.type === MARK && entry.continuedInSessionId === this.id
    } catch {
      return false
    }
  }
}
