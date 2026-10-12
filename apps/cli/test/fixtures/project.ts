import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ClaudeCodeExecution, ExecutionCatalog, ScriptedExecution } from '@weaver/agent-sdk'
import { DeclarationFolder, DeclarationParts, type PartName } from '@weaver/engine'
import type { Caller } from '../../src/caller/caller.ts'
import { CommandLine } from '../../src/commands/line/command-line.ts'
import type { Input } from '../../src/input/input.ts'
import type { EngineLink } from '../../src/link/engine-link.ts'
import type { Output } from '../../src/output/output.ts'
import { Paint } from '../../src/output/paint.ts'
import { Screen } from '../../src/output/screen.ts'
import type { ReleaseChannel } from '../../src/releases/release-channel.ts'

interface Run {
  readonly status: number
  // What the command printed, in the order it came, the error stream included.
  readonly lines: readonly string[]
}

// What surrounds a command when it runs. Left out: the real engine, a terminal of the owner's, nothing to read.
interface Around {
  readonly link?: EngineLink
  // The agent runtime the command is started under.
  readonly under?: string
  readonly input?: string
  // The agent runtimes of the machine.
  readonly executions?: ExecutionCatalog
  // Where releases come from, how one is installed and which one runs.
  readonly channel?: ReleaseChannel
}

// What a command printed, in the order it came: what it said, and what it sent to the error stream. Nothing is
// coloured, as when a program reads it.
class RecordingOutput implements Output {
  readonly paint = new Paint(false)
  readonly failPaint = new Paint(false)
  readonly lines: string[] = []
  readonly errors: string[] = []

  say(line: string): void {
    this.lines.push(...line.split('\n'))
  }

  fail(line: string): void {
    this.lines.push(line)
    this.errors.push(line)
  }
}

class GivenCaller implements Caller {
  private readonly name: string | null

  constructor(name: string | null) {
    this.name = name
  }

  agent(): string | null {
    return this.name
  }
}

class GivenInput implements Input {
  private readonly text: string

  constructor(text: string) {
    this.text = text
  }

  read(): string {
    return this.text
  }
}

export function makeProject(top: string): string {
  mkdirSync(top, { recursive: true })
  execFileSync('git', ['-C', top, 'init', '-q', '-b', 'main'])

  return top
}

// On the machine of these tests, Codex starts and Claude Code does not.
const EXECUTIONS = new ExecutionCatalog([new ScriptedExecution('codex', []), new ClaudeCodeExecution('/nowhere/claude')])

// What a page draws on a screen nobody colours.
export function drawn(page: (screen: Screen) => void): string[] {
  const output = new RecordingOutput()

  page(new Screen(output))

  return output.lines
}

// What a command sent to its error stream, apart from what it answered.
export async function failuresOf(cwd: string, args: readonly string[]): Promise<readonly string[]> {
  const output = new RecordingOutput()

  await new CommandLine(cwd, output, null, EXECUTIONS, new GivenCaller(null), new GivenInput('')).run(args)

  return output.errors
}

// These tests may themselves run under an agent: who runs a command is always given, never read from the processes.
export async function weaver(cwd: string, args: readonly string[], around: Around = {}): Promise<Run> {
  const output = new RecordingOutput()
  const caller = new GivenCaller(around.under ?? null)
  const input = new GivenInput(around.input ?? '')
  const line = new CommandLine(cwd, output, around.link ?? null, around.executions ?? EXECUTIONS, caller, input, around.channel ?? null)
  const status = await line.run(args)

  return { status, lines: output.lines }
}

// The limits every project writes, with the values a new project starts with.
export const LIMITS = { maxRefusals: 3, totalTimeoutSeconds: 1200, parallel: 3, warnTimeoutSeconds: 30 }
export const SETTINGS = { version: 2, checks: LIMITS }
export const REVIEW = { experiments: false, timeoutSeconds: 900, waitSeconds: 1500, maxRefusals: 1 }

// What a project declares, each part in the file Weaver reads it from.
export function writeConfig(top: string, parts: Readonly<Partial<Record<PartName, unknown>>>): void {
  for (const [part, value] of Object.entries(parts))
    writeJson(top, `${DeclarationFolder.NAME}/${DeclarationParts.FILES[part as PartName]}`, value)
}

export function writeJson(top: string, path: string, value: unknown): void {
  mkdirSync(dirname(join(top, path)), { recursive: true })
  writeFileSync(join(top, path), JSON.stringify(value, null, 2))
}

export const readJson = <Shape>(top: string, path: string): Shape => JSON.parse(readFileSync(join(top, path), 'utf8')) as Shape
