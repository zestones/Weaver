import type { Output } from './output.ts'
import { Paint } from './paint.ts'

type Stream = NodeJS.WritableStream & { readonly isTTY?: boolean }

export class ConsoleOutput implements Output {
  readonly paint: Paint
  readonly failPaint: Paint
  private readonly out: Stream
  private readonly err: Stream
  private readonly closed = new Set<Stream>()

  // `plain` is the owner asking for no colour, whatever the streams are.
  constructor(plain = false, out: Stream = process.stdout, err: Stream = process.stderr, env: NodeJS.ProcessEnv = process.env) {
    this.out = out
    this.err = err
    this.paint = Paint.for(out, env, plain)
    this.failPaint = Paint.for(err, env, plain)

    // A reader that leaves early, as in `weaver doctor | head -1`, is not an error: the rest is simply not said.
    for (const stream of new Set([out, err])) {
      stream.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EPIPE') throw error

        this.closed.add(stream)
      })
    }
  }

  say(line: string): void {
    this.write(this.out, line)
  }

  fail(line: string): void {
    this.write(this.err, line)
  }

  private write(stream: Stream, line: string): void {
    if (!this.closed.has(stream)) stream.write(`${line}\n`)
  }
}
