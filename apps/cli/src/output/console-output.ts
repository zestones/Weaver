import type { Output } from './output.ts'

export class ConsoleOutput implements Output {
  private readonly stream: NodeJS.WritableStream
  private closed = false

  constructor(stream: NodeJS.WritableStream = process.stdout) {
    this.stream = stream
    // A reader that leaves early, as in `weaver doctor | head -1`, is not an error: the rest is simply not said.
    stream.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') throw error

      this.closed = true
    })
  }

  say(line: string): void {
    if (!this.closed) this.stream.write(`${line}\n`)
  }
}
