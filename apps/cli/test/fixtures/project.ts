import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CommandLine } from '../../src/commands/command-line.ts'
import type { EngineLink } from '../../src/link/engine-link.ts'
import type { Output } from '../../src/output/output.ts'

interface Run {
  readonly status: number
  readonly lines: readonly string[]
}

class RecordingOutput implements Output {
  readonly lines: string[] = []

  say(line: string): void {
    this.lines.push(line)
  }
}

export function makeProject(top: string): string {
  mkdirSync(top, { recursive: true })
  execFileSync('git', ['-C', top, 'init', '-q', '-b', 'main'])

  return top
}

export function weaver(cwd: string, args: readonly string[], link: EngineLink | null = null): Run {
  const output = new RecordingOutput()
  const status = new CommandLine(cwd, output, link).run(args)

  return { status, lines: output.lines }
}

export function writeJson(top: string, path: string, value: unknown): void {
  mkdirSync(dirname(join(top, path)), { recursive: true })
  writeFileSync(join(top, path), JSON.stringify(value, null, 2))
}

export const readJson = <Shape>(top: string, path: string): Shape => JSON.parse(readFileSync(join(top, path), 'utf8')) as Shape
