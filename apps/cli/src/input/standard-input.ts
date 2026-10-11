import { readFileSync } from 'node:fs'
import type { Input } from './input.ts'

const STDIN = 0

export class StandardInput implements Input {
  // Read by its descriptor: `process.stdin` would make a pipe non-blocking, and a read that finds nothing yet would
  // fail instead of waiting.
  read(): string {
    return readFileSync(STDIN, 'utf8')
  }
}
