import type { Output } from './output.ts'

export class ConsoleOutput implements Output {
  say(line: string): void {
    process.stdout.write(`${line}\n`)
  }
}
