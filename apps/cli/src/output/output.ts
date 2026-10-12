import type { Paint } from './paint.ts'

export interface Output {
  // The styles of what is said and of what fails: each stream is a terminal or not by itself.
  readonly paint: Paint
  readonly failPaint: Paint
  // The answer of the command, on the standard output.
  say(line: string): void
  // What went wrong, on the error stream: it stays out of what a program reads of the answer.
  fail(line: string): void
}
