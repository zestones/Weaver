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

interface Run {
  readonly status: number
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
}

class RecordingOutput implements Output {
  readonly lines: string[] = []

  say(line: string): void {
    this.lines.push(line)
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

// These tests may themselves run under an agent: who runs a command is always given, never read from the processes.
export async function weaver(cwd: string, args: readonly string[], around: Around = {}): Promise<Run> {
  const output = new RecordingOutput()
  const caller = new GivenCaller(around.under ?? null)
  const input = new GivenInput(around.input ?? '')
  const status = await new CommandLine(cwd, output, around.link ?? null, around.executions ?? EXECUTIONS, caller, input).run(args)

  return { status, lines: output.lines }
}

// The limits every project writes, with the values a new project starts with.
export const LIMITS = { maxRefusals: 3, totalTimeoutSeconds: 1200, parallel: 3, warnTimeoutSeconds: 30 }
export const SETTINGS = { version: 1, checks: LIMITS }
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
